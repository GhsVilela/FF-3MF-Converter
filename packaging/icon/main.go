package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

const (
	ink    = 0x09
	blueR  = 0x00
	blueG  = 0xa0
	blueB  = 0xe9
	orange = 0xe9
)

var targetSizes = []int{16, 24, 32, 48, 64, 128, 256}

func main() {
	icoPath := flag.String("ico", "app.ico", "output ICO file")
	flag.Parse()

	if err := os.MkdirAll(filepath.Dir(*icoPath), 0o755); err != nil {
		fail(err)
	}

	images := make([][]byte, 0, len(targetSizes))
	for _, size := range targetSizes {
		img := render(size)
		var buffer []byte
		buffer, err := encodePNG(img)
		if err != nil {
			fail(err)
		}
		images = append(images, buffer)
	}

	if err := writeICO(*icoPath, images); err != nil {
		fail(err)
	}
	fmt.Printf("Wrote %s (%d sizes)\n", *icoPath, len(images))
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func rgba(r, g, b, a uint8) color.RGBA {
	return color.RGBA{R: r, G: g, B: b, A: a}
}

func render(size int) image.Image {
	const supersample = 4
	hi := size * supersample
	img := image.NewRGBA(image.Rect(0, 0, hi, hi))

	// Rounded dark tile.
	fillRoundedRect(img, 0, 0, float64(hi), float64(hi), float64(hi)*0.16, rgba(ink, 0x12, 0x1a, 0xff))

	blue := rgba(blueR, blueG, blueB, 0xff)
	orangeColor := rgba(orange, 0x61, 0x14, 0xff)
	line := math.Max(float64(hi)*0.052, float64(supersample))

	// Isometric cube mark.
	pt := func(x, y float64) (float64, float64) { return x * float64(hi), y * float64(hi) }
	tx, ty := pt(0.50, 0.17)
	rx, ry := pt(0.79, 0.34)
	bx, by := pt(0.50, 0.51)
	lx, ly := pt(0.21, 0.34)
	rbx, rby := pt(0.79, 0.67)
	bbx, bby := pt(0.50, 0.84)
	lbx, lby := pt(0.21, 0.67)

	for _, segment := range [][4]float64{
		{tx, ty, rx, ry},
		{rx, ry, bx, by},
		{bx, by, lx, ly},
		{lx, ly, tx, ty},
		{lx, ly, lbx, lby},
		{rx, ry, rbx, rby},
		{bx, by, bbx, bby},
		{lbx, lby, bbx, bby},
		{rbx, rby, bbx, bby},
	} {
		drawLine(img, segment[0], segment[1], segment[2], segment[3], line, blue)
	}

	// Orange registration corner, echoing the brand mark.
	cornerLine := math.Max(line*0.9, float64(supersample))
	drawLine(img, 0.71*float64(hi), 0.12*float64(hi), 0.86*float64(hi), 0.12*float64(hi), cornerLine, orangeColor)
	drawLine(img, 0.86*float64(hi), 0.12*float64(hi), 0.86*float64(hi), 0.27*float64(hi), cornerLine, orangeColor)

	return downsample(img, supersample)
}

func fillRoundedRect(img *image.RGBA, x0, y0, x1, y1, radius float64, c color.RGBA) {
	for y := int(math.Floor(y0)); y < int(math.Ceil(y1)); y++ {
		for x := int(math.Floor(x0)); x < int(math.Ceil(x1)); x++ {
			px := float64(x) + 0.5
			py := float64(y) + 0.5
			dx := math.Max(math.Max(x0+radius-px, px-(x1-radius)), 0)
			dy := math.Max(math.Max(y0+radius-py, py-(y1-radius)), 0)
			if dx*dx+dy*dy <= radius*radius {
				img.SetRGBA(x, y, c)
			}
		}
	}
}

func drawLine(img *image.RGBA, x0, y0, x1, y1, width float64, c color.RGBA) {
	minX := int(math.Floor(math.Min(x0, x1) - width))
	maxX := int(math.Ceil(math.Max(x0, x1) + width))
	minY := int(math.Floor(math.Min(y0, y1) - width))
	maxY := int(math.Ceil(math.Max(y0, y1) + width))
	half := width / 2
	for y := minY; y <= maxY; y++ {
		for x := minX; x <= maxX; x++ {
			px := float64(x) + 0.5
			py := float64(y) + 0.5
			if distanceToSegment(px, py, x0, y0, x1, y1) <= half {
				img.SetRGBA(x, y, c)
			}
		}
	}
}

func distanceToSegment(px, py, x0, y0, x1, y1 float64) float64 {
	dx := x1 - x0
	dy := y1 - y0
	if dx == 0 && dy == 0 {
		return math.Hypot(px-x0, py-y0)
	}
	t := ((px-x0)*dx + (py-y0)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(px-(x0+t*dx), py-(y0+t*dy))
}

func downsample(src *image.RGBA, factor int) *image.RGBA {
	width := src.Bounds().Dx() / factor
	height := src.Bounds().Dy() / factor
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			var r, g, b, a uint32
			for dy := 0; dy < factor; dy++ {
				for dx := 0; dx < factor; dx++ {
					c := src.RGBAAt(x*factor+dx, y*factor+dy)
					r += uint32(c.R) * uint32(c.A)
					g += uint32(c.G) * uint32(c.A)
					b += uint32(c.B) * uint32(c.A)
					a += uint32(c.A)
				}
			}
			if a == 0 {
				dst.SetRGBA(x, y, rgba(0, 0, 0, 0))
				continue
			}
			dst.SetRGBA(x, y, rgba(uint8(r/a), uint8(g/a), uint8(b/a), uint8(a/(uint32(factor*factor)))))
		}
	}
	return dst
}

func encodePNG(img image.Image) ([]byte, error) {
	var buffer []byte
	writer := &sliceWriter{data: &buffer}
	if err := png.Encode(writer, img); err != nil {
		return nil, err
	}
	return buffer, nil
}

type sliceWriter struct {
	data *[]byte
}

func (w *sliceWriter) Write(p []byte) (int, error) {
	*w.data = append(*w.data, p...)
	return len(p), nil
}

func writeICO(path string, images [][]byte) error {
	header := make([]byte, 6+16*len(images))
	binary.LittleEndian.PutUint16(header[0:], 0)
	binary.LittleEndian.PutUint16(header[2:], 1)
	binary.LittleEndian.PutUint16(header[4:], uint16(len(images)))

	offset := 6 + 16*len(images)
	for index, data := range images {
		size := targetSizes[index]
		entry := 6 + index*16
		if size >= 256 {
			header[entry] = 0
			header[entry+1] = 0
		} else {
			header[entry] = byte(size)
			header[entry+1] = byte(size)
		}
		header[entry+2] = 0
		header[entry+3] = 0
		binary.LittleEndian.PutUint16(header[entry+4:], 1)
		binary.LittleEndian.PutUint16(header[entry+6:], 32)
		binary.LittleEndian.PutUint32(header[entry+8:], uint32(len(data)))
		binary.LittleEndian.PutUint32(header[entry+12:], uint32(offset))
		offset += len(data)
	}

	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(header); err != nil {
		return err
	}
	for _, data := range images {
		if _, err := file.Write(data); err != nil {
			return err
		}
	}
	return nil
}
