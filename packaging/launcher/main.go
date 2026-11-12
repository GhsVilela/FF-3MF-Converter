package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

func main() {
	var (
		port      = flag.Int("port", 8080, "preferred HTTP port")
		host      = flag.String("host", "127.0.0.1", "HTTP bind address")
		dataDir   = flag.String("data-dir", "", "data directory (defaults to the user data folder)")
		noBrowser = flag.Bool("no-browser", false, "do not open a browser window")
		showVer   = flag.Bool("version", false, "print the version and exit")
	)
	flag.Usage = func() {
		fmt.Fprintf(flag.CommandLine.Output(), "FF-3MF Converter %s\n\n", version)
		fmt.Fprintf(flag.CommandLine.Output(), "Usage: %s [options]\n\n", filepath.Base(os.Args[0]))
		flag.PrintDefaults()
	}
	flag.Parse()

	if *showVer {
		fmt.Printf("FF-3MF Converter %s\n", version)
		return
	}

	exePath, err := os.Executable()
	if err != nil {
		fatal("Cannot determine the executable path: %v", err)
	}
	root := filepath.Dir(exePath)
	appDir := filepath.Join(root, "app")
	serverPath := filepath.Join(appDir, "apps", "api", "dist", "server.js")
	nodeName := "node"
	if runtime.GOOS == "windows" {
		nodeName = "node.exe"
	}
	nodePath := filepath.Join(root, "runtime", nodeName)

	if _, err := os.Stat(nodePath); err != nil {
		fatal("The bundled Node runtime is missing at %s", nodePath)
	}
	if _, err := os.Stat(serverPath); err != nil {
		fatal("The application files are missing at %s", serverPath)
	}

	resolvedDataDir := *dataDir
	if resolvedDataDir == "" {
		resolvedDataDir = defaultDataDir()
	}
	if err := os.MkdirAll(resolvedDataDir, 0o755); err != nil {
		fatal("Cannot create the data directory %s: %v", resolvedDataDir, err)
	}

	listenHost := *host
	if listenHost == "" {
		listenHost = "127.0.0.1"
	}
	selectedPort, err := choosePort(listenHost, *port)
	if err != nil {
		fatal("No free HTTP port found starting at %d: %v", *port, err)
	}

	urlHost := "127.0.0.1"
	if listenHost != "0.0.0.0" && listenHost != "::" {
		urlHost = listenHost
	}
	url := fmt.Sprintf("http://%s:%d", urlHost, selectedPort)

	fmt.Printf("FF-3MF Converter %s\n", version)
	fmt.Printf("Data:    %s\n", resolvedDataDir)
	fmt.Printf("Open:    %s\n", url)
	fmt.Println("Press Ctrl+C to stop.")
	fmt.Println()

	cmd := exec.Command(nodePath, serverPath)
	cmd.Dir = appDir
	cmd.Env = setEnv(os.Environ(), map[string]string{
		"NODE_ENV": "production",
		"PORT":     strconv.Itoa(selectedPort),
		"HOST":     listenHost,
		"DATA_DIR": resolvedDataDir,
	})
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin

	if err := cmd.Start(); err != nil {
		fatal("Cannot start the application: %v", err)
	}

	waitDone := make(chan error, 1)
	go func() {
		waitDone <- cmd.Wait()
	}()

	if !*noBrowser {
		go func() {
			if waitForHealth(url, 25*time.Second) {
				if err := openBrowser(url); err != nil {
					fmt.Printf("Open this URL in your browser: %s\n", url)
				}
			} else {
				fmt.Printf("Open this URL in your browser: %s\n", url)
			}
		}()
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)

	select {
	case sig := <-signals:
		fmt.Printf("\nStopping (%s)...\n", sig)
		_ = cmd.Process.Kill()
		<-waitDone
	case err := <-waitDone:
		if err != nil {
			if exitError, ok := err.(*exec.ExitError); ok {
				os.Exit(exitError.ExitCode())
			}
			fatal("The application stopped: %v", err)
		}
	}
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "FF-3MF: "+format+"\n", args...)
	os.Exit(1)
}

func setEnv(base []string, values map[string]string) []string {
	result := make([]string, 0, len(base)+len(values))
	for _, item := range base {
		key := item
		if index := strings.IndexByte(item, '='); index >= 0 {
			key = item[:index]
		}
		if _, replaced := values[key]; replaced {
			continue
		}
		result = append(result, item)
	}
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result
}

func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		if base := os.Getenv("LOCALAPPDATA"); base != "" {
			return filepath.Join(base, "FF-3MF", "data")
		}
		if base := os.Getenv("APPDATA"); base != "" {
			return filepath.Join(base, "FF-3MF", "data")
		}
	} else {
		if base := os.Getenv("XDG_DATA_HOME"); base != "" {
			return filepath.Join(base, "ff3mf")
		}
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".local", "share", "ff3mf")
		}
	}
	exe, err := os.Executable()
	if err == nil {
		return filepath.Join(filepath.Dir(exe), "data")
	}
	return filepath.Join(".", "data")
}

func choosePort(host string, preferred int) (int, error) {
	checkHost := host
	if checkHost == "0.0.0.0" || checkHost == "::" {
		checkHost = "127.0.0.1"
	}
	for port := preferred; port < preferred+100; port++ {
		listener, err := net.Listen("tcp", net.JoinHostPort(checkHost, strconv.Itoa(port)))
		if err == nil {
			_ = listener.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("all candidate ports are in use")
}

func waitForHealth(baseURL string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 800 * time.Millisecond}
	for time.Now().Before(deadline) {
		response, err := client.Get(baseURL + "/api/health")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return true
			}
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		if err := exec.Command("xdg-open", url).Start(); err == nil {
			return nil
		}
		return exec.Command("sensible-browser", url).Start()
	}
}
