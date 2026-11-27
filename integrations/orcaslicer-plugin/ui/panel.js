/* global window, document, URL, FileReader */
(() => {
  'use strict';

  const FILE_CHUNK_BYTES = 512 * 1024;
  const PREVIEW_CACHE_LIMIT = 32;
  const $ = (id) => document.getElementById(id);

  const state = {
    view: null,
    draft: { apiUrl: '', outputDir: '' },
    draftDirty: false,
    settingsOpen: false,
    tokenAction: 'keep',
    target: { printerId: '', nozzle: '', processName: '' },
    options: {
      preserveTemperatures: true,
      keepAllColors: false,
      layout: 'center',
    },
    mapping: {},
    mappingTouched: false,
    analysisKey: '',
    previewIndex: 0,
    previewImages: new Map(),
    previewLoading: new Set(),
    previewErrors: new Set(),
    dismissedError: '',
    dismissedNotice: '',
    localError: null,
    fileTransfer: null,
  };

  function post(message) {
    try {
      if (window.orca && typeof window.orca.postMessage === 'function') {
        window.orca.postMessage(message);
      }
    } catch {
      // The host can tear down the page while a message is being posted.
    }
  }

  function handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'preview' || message.type === 'preview-error') {
      handlePreviewMessage(message);
      return;
    }
    if (typeof message.type === 'string' && message.type.startsWith('file-')) {
      handleFileMessage(message);
      return;
    }
    if (message.type === 'progress') {
      if (state.view) {
        state.view.progress = message.progress || state.view.progress;
        renderRun();
      }
      return;
    }
    if (message.type !== 'snapshot') return;
    state.view = message;
    syncFromView();
    renderAll();
  }

  function syncFromView() {
    const view = state.view;
    if (!view) return;
    if (
      state.draftDirty &&
      state.draft.apiUrl === (view.config?.apiUrl || '') &&
      state.draft.outputDir === (view.config?.outputDir || '')
    ) {
      state.draftDirty = false;
    }
    if (!state.draftDirty) {
      state.draft.apiUrl = view.config?.apiUrl || '';
      state.draft.outputDir = view.config?.outputDir || '';
    }
    ensureTargets();
    syncAnalysis();
    ensureMapping();
    if (!view.error && !state.localError) state.dismissedError = '';
    const hasNotice =
      (view.error && isNoticeCode(view.error.code)) || view.connection?.status === 'auth-required';
    if (!hasNotice) state.dismissedNotice = '';
  }

  function syncAnalysis() {
    const analysis = state.view?.analysis;
    const key = analysis
      ? `${analysis.uploadId || ''}:${usedColors()
          .map((color) => `${color.slot}:${color.color}:${color.type}`)
          .join('|')}`
      : '';
    if (key !== state.analysisKey) {
      state.analysisKey = key;
      state.mappingTouched = false;
      state.mapping = {};
      state.options.keepAllColors = false;
      state.previewIndex = 0;
      state.previewImages.clear();
      state.previewLoading.clear();
      state.previewErrors.clear();
    }
  }

  function printerList() {
    return Array.isArray(state.view?.printers?.printers) ? state.view.printers.printers : [];
  }

  function selectedPrinter() {
    return printerList().find((printer) => printer.id === state.target.printerId) || null;
  }

  function selectedNozzle() {
    const printer = selectedPrinter();
    if (!printer || !Array.isArray(printer.nozzles)) return null;
    return (
      printer.nozzles.find((nozzle) => String(nozzle.diameter) === String(state.target.nozzle)) ||
      null
    );
  }

  function usedColors() {
    const colors = state.view?.analysis?.analysis?.colors;
    if (!Array.isArray(colors)) return [];
    return colors
      .filter((color) => color && color.used === true && Number.isFinite(Number(color.slot)))
      .sort((left, right) => Number(left.slot) - Number(right.slot));
  }

  function sourceState() {
    const source = state.view?.source || {};
    return {
      mode: source.mode === 'selected' ? 'selected' : 'current',
      selectedFile: source.selectedFile || null,
      transfer: source.transfer || null,
    };
  }

  function localTransferState() {
    if (!state.fileTransfer) return null;
    return {
      id: state.fileTransfer.id,
      name: state.fileTransfer.name,
      received: state.fileTransfer.received,
      total: state.fileTransfer.size,
    };
  }

  function activeTransferState() {
    const sourceTransfer = sourceState().transfer;
    const localTransfer = localTransferState();
    if (localTransfer && (!sourceTransfer || sourceTransfer.id === localTransfer.id)) {
      return localTransfer;
    }
    return sourceTransfer;
  }

  function transferPercent(transfer) {
    if (!transfer || !transfer.total) return 0;
    return Math.max(
      0,
      Math.min(100, Math.round((Number(transfer.received) / Number(transfer.total)) * 100)),
    );
  }

  function showLocalError(message, code = 'FILE_SELECTION') {
    state.localError = { code, message };
    state.dismissedError = '';
    renderBanners();
  }

  function ensureTargets() {
    const printers = printerList();
    let printer = printers.find((item) => item.id === state.target.printerId) || null;
    if (!printer) {
      const preferredId = state.view?.config?.lastPrinterId;
      printer =
        printers.find((item) => item.id === preferredId) || (printers.length ? printers[0] : null);
      state.target.printerId = printer ? printer.id : '';
      state.target.nozzle = '';
      state.target.processName = '';
      state.mappingTouched = false;
    }
    if (!printer) {
      state.target.nozzle = '';
      state.target.processName = '';
      return;
    }

    const nozzles = Array.isArray(printer.nozzles) ? printer.nozzles : [];
    let nozzle = nozzles.find((item) => String(item.diameter) === String(state.target.nozzle));
    if (!nozzle) {
      const preferredNozzle = state.view?.config?.lastNozzle;
      nozzle =
        nozzles.find((item) => String(item.diameter) === String(preferredNozzle)) ||
        nozzles.find((item) => String(item.diameter) === '0.4') ||
        nozzles[0] ||
        null;
      state.target.nozzle = nozzle ? String(nozzle.diameter) : '';
      state.target.processName = '';
      state.mappingTouched = false;
    }
    if (!nozzle) {
      state.target.processName = '';
      return;
    }
    const processes = Array.isArray(nozzle.processes) ? nozzle.processes : [];
    if (
      state.target.processName &&
      !processes.some((process) => process.name === state.target.processName)
    ) {
      state.target.processName = '';
    }
  }

  function targetSlotCount() {
    const printer = selectedPrinter();
    const used = usedColors();
    const max = Number(printer?.maxColors) || 1;
    const keepAll = keepAllAvailable() && state.options.keepAllColors;
    return keepAll ? Math.max(max, used.length) : max;
  }

  function keepAllAvailable() {
    const printer = selectedPrinter();
    const used = usedColors();
    return Boolean(
      printer && Number(printer.maxColors) > 1 && used.length > Number(printer.maxColors),
    );
  }

  function defaultMapping() {
    const printer = selectedPrinter();
    const used = usedColors();
    const max = Number(printer?.maxColors) || 1;
    const result = {};
    used.forEach((color, index) => {
      result[String(color.slot)] = max === 1 ? 1 : (index % max) + 1;
    });
    return result;
  }

  function ensureMapping() {
    const printer = selectedPrinter();
    const used = usedColors();
    if (!printer || used.length === 0) {
      state.mapping = {};
      return;
    }
    const defaults = defaultMapping();
    const slots = targetSlotCount();
    const next = {};
    used.forEach((color) => {
      const key = String(color.slot);
      const current = Number(state.mapping[key]);
      next[key] =
        Number.isInteger(current) && current >= 1 && current <= slots
          ? current
          : defaults[key] || 1;
    });
    state.mapping = next;
    if (!keepAllAvailable() && state.options.keepAllColors) {
      state.options.keepAllColors = false;
    }
  }

  function currentOptions() {
    const printer = selectedPrinter();
    const used = usedColors();
    const max = Number(printer?.maxColors) || 1;
    const mapping = {};
    if (max > 1 && used.length) {
      used.forEach((color) => {
        const value = Number(state.mapping[String(color.slot)]);
        if (Number.isInteger(value) && value >= 1) mapping[String(color.slot)] = value;
      });
    }
    return {
      colorMapping: mapping,
      preserveTemperatures: Boolean(state.options.preserveTemperatures),
      keepAllColors: keepAllAvailable() && Boolean(state.options.keepAllColors),
      layout: state.options.layout,
    };
  }

  function currentTarget() {
    return {
      printerId: state.target.printerId,
      nozzle: state.target.nozzle,
      processName: state.target.processName || undefined,
    };
  }

  function isNoticeCode(code) {
    return code === 'SOURCE_WARNING' || code === 'CANCELLED' || code === 'PROJECT_CHANGED';
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value === undefined || value === null ? '' : String(value);
  }

  function setHidden(elementOrId, hidden) {
    const element = typeof elementOrId === 'string' ? $(elementOrId) : elementOrId;
    if (element) element.hidden = Boolean(hidden);
  }

  function makeOption(label, value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function syncSelect(select, items, value) {
    if (!select) return;
    const signature = items.map((item) => `${item.value}\u0000${item.label}`).join('\u0001');
    if (select.dataset.signature !== signature) {
      select.replaceChildren();
      items.forEach((item) => select.add(makeOption(item.label, item.value)));
      select.dataset.signature = signature;
    }
    if (value !== undefined && value !== null && String(value) !== '') {
      select.value = String(value);
    }
    if (!select.value && items.length) select.value = items[0].value;
  }

  function safeColor(value) {
    const color = String(value || '');
    return /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : '#8a969a';
  }

  function makeSwatch(color, className = 'swatch') {
    const element = document.createElement('span');
    element.className = className;
    element.style.backgroundColor = safeColor(color);
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '--';
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatDuration(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return '--';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  function hostFromUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      return parsed.host || parsed.origin;
    } catch {
      return 'the configured FF-3MF instance';
    }
  }

  function isLoopback(hostname) {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname).toLowerCase());
  }

  function transferRejectAll(error) {
    const transfer = state.fileTransfer;
    if (!transfer) return;
    for (const waiter of transfer.waiters.values()) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    transfer.waiters.clear();
  }

  function transferWait(key, timeoutMs = 30000) {
    const transfer = state.fileTransfer;
    if (!transfer) return Promise.reject(new Error('No file transfer is active.'));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        transfer.waiters.delete(key);
        reject(new Error('The file transfer timed out.'));
      }, timeoutMs);
      transfer.waiters.set(key, { resolve, reject, timer });
    });
  }

  function transferResolve(key, value) {
    const transfer = state.fileTransfer;
    if (!transfer) return;
    const waiter = transfer.waiters.get(key);
    if (!waiter) return;
    window.clearTimeout(waiter.timer);
    transfer.waiters.delete(key);
    waiter.resolve(value);
  }

  function abortLocalTransfer() {
    if (!state.fileTransfer) return;
    const transfer = state.fileTransfer;
    state.fileTransfer = null;
    for (const waiter of transfer.waiters.values()) {
      window.clearTimeout(waiter.timer);
      waiter.reject(new Error('The file transfer was cancelled.'));
    }
    transfer.waiters.clear();
    renderProject();
    renderRun();
  }

  function newTransferId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function readSliceBase64(file, start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        if (comma < 0) {
          reject(new Error('The selected file could not be read.'));
          return;
        }
        resolve(result.slice(comma + 1));
      };
      reader.onerror = () => reject(new Error('The selected file could not be read.'));
      reader.readAsDataURL(file.slice(start, end));
    });
  }

  function handleFileMessage(message) {
    const transfer = state.fileTransfer;
    if (!transfer || message.transferId !== transfer.id) return;
    if (message.type === 'file-started') {
      transferResolve('started');
      return;
    }
    if (message.type === 'file-chunk-ack') {
      transferResolve(`chunk:${message.index}`);
      return;
    }
    if (message.type === 'file-progress') {
      transfer.received = Number(message.received) || 0;
      renderProject();
      return;
    }
    if (message.type === 'file-complete') {
      transfer.received = transfer.size;
      transferResolve('complete');
      return;
    }
    if (message.type === 'file-error') {
      const error = message.error || {
        code: 'FILE_TRANSFER_FAILED',
        message: 'The selected file could not be imported.',
      };
      transferRejectAll(new Error(error.message || 'The file transfer failed.'));
      state.fileTransfer = null;
      state.localError = error;
      state.dismissedError = '';
      renderProject();
      renderBanners();
    }
  }

  async function startFileTransfer(file) {
    if (state.view?.busy) {
      showLocalError('Wait for the current operation to finish before selecting a file.');
      return;
    }
    if (state.fileTransfer) abortLocalTransfer();
    const lowerName = String(file.name || '').toLowerCase();
    if (!lowerName.endsWith('.3mf')) {
      showLocalError('Select an editable .3mf project file.');
      return;
    }
    if (lowerName.endsWith('.gcode.3mf')) {
      showLocalError('That is a sliced print file. Select the editable .3mf project instead.');
      return;
    }
    if (!file.size) {
      showLocalError('The selected file is empty.');
      return;
    }
    const maxUploadMb = Number(state.view?.printers?.maxUploadMb);
    if (Number.isFinite(maxUploadMb) && maxUploadMb > 0 && file.size > maxUploadMb * 1024 * 1024) {
      showLocalError(`The selected file is larger than the ${maxUploadMb} MB server upload limit.`);
      return;
    }

    state.localError = null;
    renderBanners();
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_BYTES);
    const transfer = {
      id: newTransferId(),
      name: file.name,
      size: file.size,
      received: 0,
      totalChunks,
      waiters: new Map(),
    };
    state.fileTransfer = transfer;
    renderProject();
    post({ type: 'set-source', source: 'selected' });
    post({
      type: 'file-begin',
      transferId: transfer.id,
      name: file.name,
      size: file.size,
      totalChunks,
    });

    try {
      await transferWait('started', 15000);
      for (let index = 0; index < totalChunks; index += 1) {
        if (state.fileTransfer?.id !== transfer.id)
          throw new Error('The file transfer was cancelled.');
        const start = index * FILE_CHUNK_BYTES;
        const end = Math.min(file.size, start + FILE_CHUNK_BYTES);
        const data = await readSliceBase64(file, start, end);
        if (state.fileTransfer?.id !== transfer.id)
          throw new Error('The file transfer was cancelled.');
        post({
          type: 'file-chunk',
          transferId: transfer.id,
          index,
          data,
        });
        await transferWait(`chunk:${index}`, 60000);
        transfer.received = Math.min(transfer.size, (index + 1) * FILE_CHUNK_BYTES);
        renderProject();
      }
      await transferWait('complete', 30000);
    } catch (error) {
      if (state.fileTransfer?.id === transfer.id) {
        state.fileTransfer = null;
        if (!state.localError) {
          state.localError = {
            code: 'FILE_TRANSFER_FAILED',
            message: error instanceof Error ? error.message : 'The file transfer failed.',
          };
        }
        post({ type: 'clear-selected-file' });
        renderProject();
        renderBanners();
      }
    } finally {
      if (state.fileTransfer?.id === transfer.id) state.fileTransfer = null;
      renderProject();
    }
  }

  function renderConnection() {
    const connection = state.view?.connection || {};
    const status = connection.status || 'unknown';
    const pill = $('connection-pill');
    if (pill) {
      pill.dataset.state = status;
      pill.title =
        connection.message ||
        (status === 'online' ? 'FF-3MF is reachable.' : 'Click to check the FF-3MF connection.');
    }
    const version = connection.version || state.view?.meta?.apiVersion || '';
    const labels = {
      online: version ? `Online · v${version}` : 'Online',
      checking: 'Checking',
      offline: 'Offline',
      'auth-required': 'Token required',
      unknown: 'Not checked',
    };
    setText('connection-text', labels[status] || 'Not checked');
    setText('api-version', version ? `API v${version}` : 'API --');
    setText('footer-api', version ? `API v${version}` : 'API --');
  }

  function previewList() {
    const analysis = state.view?.analysis;
    if (!analysis) return [];
    const plates = Array.isArray(analysis.previewPlates)
      ? analysis.previewPlates
          .map((plate) => Number(plate))
          .filter((plate) => Number.isInteger(plate) && plate > 0)
      : [];
    if (plates.length) return plates.map((plate) => ({ plate }));
    if (typeof analysis.thumbnail === 'string' && analysis.thumbnail) {
      return [{ plate: 1, image: analysis.thumbnail }];
    }
    return [];
  }

  function previewPlateCount(previews) {
    const analysis = state.view?.analysis?.analysis;
    const total = Number(analysis?.plates);
    const maxPreview = previews.reduce((maximum, preview) => Math.max(maximum, preview.plate), 0);
    return Math.max(1, Number.isFinite(total) ? total : 0, maxPreview, previews.length);
  }

  function requestPreview(plate, force = false) {
    const analysis = state.view?.analysis;
    if (!analysis || !analysis.uploadId) return;
    if (force) state.previewErrors.delete(plate);
    if (
      state.previewImages.has(plate) ||
      state.previewLoading.has(plate) ||
      state.previewErrors.has(plate)
    ) {
      return;
    }
    state.previewLoading.add(plate);
    post({
      type: 'preview-request',
      uploadId: analysis.uploadId,
      plate,
    });
  }

  function handlePreviewMessage(message) {
    const analysis = state.view?.analysis;
    if (!analysis) return;
    if (message.uploadId && message.uploadId !== analysis.uploadId) return;
    const plate = Number(message.plate);
    if (!Number.isInteger(plate) || plate <= 0) return;
    state.previewLoading.delete(plate);
    if (message.type === 'preview-error') {
      state.previewErrors.add(plate);
    } else if (
      typeof message.image === 'string' &&
      /^data:image\/(?:png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(message.image)
    ) {
      state.previewErrors.delete(plate);
      state.previewImages.set(plate, message.image);
      while (state.previewImages.size > PREVIEW_CACHE_LIMIT) {
        const oldest = state.previewImages.keys().next().value;
        if (oldest === plate) break;
        state.previewImages.delete(oldest);
      }
    } else {
      state.previewErrors.add(plate);
    }
    renderPreview();
  }

  function previewStep(delta) {
    const previews = previewList();
    if (previews.length < 2) return;
    state.previewIndex = (state.previewIndex + delta + previews.length) % previews.length;
    renderPreview();
    const current = previews[state.previewIndex];
    if (current) requestPreview(current.plate, true);
  }

  function renderPreview() {
    const previews = previewList();
    if (previews.length === 0) {
      state.previewIndex = 0;
    } else {
      state.previewIndex = Math.max(0, Math.min(state.previewIndex, previews.length - 1));
    }
    const current = previews[state.previewIndex];
    const image = $('preview-image');
    const empty = $('preview-empty');
    const imageUrl = current ? state.previewImages.get(current.plate) || current.image : null;
    const safeImage =
      typeof imageUrl === 'string' &&
      /^data:image\/(?:png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(imageUrl);
    if (image && empty) {
      if (safeImage) {
        image.src = imageUrl;
        image.alt = current ? `Preview of plate ${current.plate}` : 'Plate preview';
        image.hidden = false;
        empty.hidden = true;
      } else {
        image.removeAttribute('src');
        image.hidden = true;
        empty.hidden = false;
      }
    }

    if (!current) {
      setText('preview-empty-title', state.view?.analysis ? 'NO PLATE PREVIEW' : 'NO PREVIEW');
      setText(
        'preview-empty-message',
        state.view?.analysis
          ? 'This source does not include plate renders.'
          : 'Analyse the source to load the plate renders.',
      );
    } else if (state.previewLoading.has(current.plate)) {
      setText('preview-empty-title', 'LOADING PREVIEW');
      setText('preview-empty-message', `Fetching plate ${current.plate}…`);
    } else if (state.previewErrors.has(current.plate)) {
      setText('preview-empty-title', 'PREVIEW UNAVAILABLE');
      setText('preview-empty-message', `Plate ${current.plate} could not be loaded.`);
    } else {
      setText('preview-empty-title', 'LOADING PREVIEW');
      setText('preview-empty-message', `Fetching plate ${current.plate}…`);
    }
    if (!safeImage && current) requestPreview(current.plate);

    const multiple = previews.length > 1;
    setHidden('preview-controls', previews.length === 0);
    setHidden('preview-prev', !multiple);
    setHidden('preview-next', !multiple);
    setHidden('preview-pager', previews.length === 0);
    const carousel = $('preview-carousel');
    if (carousel) {
      carousel.tabIndex = multiple ? 0 : -1;
      carousel.setAttribute(
        'aria-label',
        multiple ? 'Build plate preview carousel' : 'Build plate preview',
      );
    }
    if (current) {
      const total = previewPlateCount(previews);
      setText('preview-label', `PLATE ${current.plate} OF ${total}`);
      const pager = $('preview-pager');
      if (pager) {
        pager.title =
          previews.length < total
            ? `Previews are available for ${previews.length} of ${total} plates.`
            : previews.length > 1
              ? 'Use the arrows to switch plates.'
              : 'Plate preview.';
      }
    } else {
      setText('preview-label', 'PLATE --');
    }
  }

  function renderProject() {
    const project = state.view?.project || {};
    const source = sourceState();
    const selectedMode = source.mode === 'selected';
    const selected = source.selectedFile;
    const transfer = activeTransferState();
    const busy = Boolean(state.view?.busy);
    const connection = state.view?.connection?.status || 'unknown';
    const transferActive = Boolean(transfer);

    const currentTab = $('source-current');
    const fileTab = $('source-file');
    if (currentTab) {
      currentTab.setAttribute('aria-pressed', String(!selectedMode));
      currentTab.disabled = busy || transferActive;
    }
    if (fileTab) {
      fileTab.setAttribute('aria-pressed', String(selectedMode));
      fileTab.disabled = busy || transferActive;
    }

    setHidden('file-source-controls', !selectedMode);
    setHidden('open-project-folder', selectedMode);
    setHidden('project-dirty', selectedMode || !project.dirty);
    setText('project-mode-label', selectedMode ? 'FILE' : 'EXPORT');

    const chooseButton = $('choose-file-button');
    if (chooseButton) chooseButton.disabled = busy || transferActive;
    const clearButton = $('clear-selected-file');
    if (clearButton) clearButton.disabled = busy || (!selected && !transferActive);

    let name;
    let pathLabel;
    let mode;
    let hint;
    if (selectedMode) {
      if (transfer) {
        const percent = transferPercent(transfer);
        name = transfer.name || 'Selected file';
        pathLabel = 'Selected .3mf file';
        mode = `Transferring… ${formatBytes(transfer.received)} / ${formatBytes(transfer.total)}`;
        hint =
          'The file is being copied into the plugin data folder. Analysis starts after it is ready.';
        setHidden('file-transfer-progress', false);
        setText('file-transfer-label', `Transferring ${transfer.name || 'file'}`);
        setText('file-transfer-percent', `${percent}%`);
        const fill = $('file-transfer-fill');
        if (fill) fill.style.width = `${percent}%`;
      } else {
        setHidden('file-transfer-progress', true);
        if (selected) {
          name = selected.name || 'Selected file';
          pathLabel = 'Selected .3mf file';
          mode = `${formatBytes(selected.size)} · Ready${selected.hasSettings ? '' : ' · geometry only'}`;
          hint = 'This file is uploaded directly; the OrcaSlicer project is not used.';
        } else {
          name = 'No file selected';
          pathLabel = 'Choose a .3mf file';
          mode = 'Select an editable project file.';
          hint = 'Choose an editable .3mf project file to use as the conversion source.';
        }
      }
    } else {
      setHidden('file-transfer-progress', true);
      name = project.name || 'Untitled project';
      pathLabel = project.path || 'Not saved yet';
      mode = 'A temporary copy will be exported.';
      if (project.path && !project.dirty) mode = 'Uses the saved project file.';
      else if (project.dirty && project.canExportCopy)
        mode = 'Exports the current session, including unsaved changes.';
      else if (project.dirty) mode = 'Unsaved changes cannot be exported by this OrcaSlicer build.';
      hint = 'Unsaved changes are included when OrcaSlicer can export a temporary copy.';
      if (!project.canExportCopy) {
        hint = project.dirty
          ? 'This OrcaSlicer build cannot export a temporary copy. Save the project before analysing.'
          : 'This OrcaSlicer build will use the saved project file.';
      } else if (project.path && !project.dirty) {
        hint = 'The saved project is uploaded without modifying it.';
      } else if (project.path && project.dirty) {
        hint = 'The temporary copy includes the current, unsaved state of the project.';
      }
    }
    setText('project-name', name);
    setText('project-path', pathLabel);
    setText('project-mode', mode);
    setText('project-hint', hint);
    setText('selected-file-name', selected?.name || transfer?.name || 'No file selected');
    setText(
      'selected-file-size',
      selected ? formatBytes(selected.size) : transfer ? formatBytes(transfer.total) : '',
    );
    setText(
      'selected-file-status',
      transfer
        ? `Transferring · ${transferPercent(transfer)}%`
        : selected
          ? `Ready${selected.hasSettings ? '' : ' · geometry only'}`
          : 'Choose a .3mf file',
    );

    renderPreview();

    const analyzeButton = $('analyze-button');
    if (analyzeButton) {
      analyzeButton.disabled =
        busy ||
        transferActive ||
        connection === 'offline' ||
        connection === 'auth-required' ||
        (selectedMode && !selected);
    }
    const folderButton = $('open-project-folder');
    if (folderButton) folderButton.disabled = !project.path;
  }

  function renderTargets() {
    const printers = printerList();
    const printerItems = printers.length
      ? printers.map((printer) => ({ value: printer.id, label: printer.name || printer.id }))
      : [{ value: '', label: 'Connect to load printers' }];
    syncSelect($('printer-select'), printerItems, state.target.printerId);

    const printer = selectedPrinter();
    const nozzles = printer && Array.isArray(printer.nozzles) ? printer.nozzles : [];
    const nozzleItems = nozzles.length
      ? nozzles.map((nozzle) => ({
          value: String(nozzle.diameter),
          label: `${nozzle.diameter} mm`,
        }))
      : [{ value: '', label: 'No nozzles available' }];
    syncSelect($('nozzle-select'), nozzleItems, state.target.nozzle);

    const nozzle = selectedNozzle();
    const processes = nozzle && Array.isArray(nozzle.processes) ? nozzle.processes : [];
    const processItems = [
      { value: '', label: 'Auto — match project layer height' },
      ...processes.map((process) => ({
        value: process.name,
        label: `${process.name} · ${process.layerHeight} mm`,
      })),
    ];
    syncSelect($('process-select'), processItems, state.target.processName);

    const busy = Boolean(state.view?.busy);
    [
      'printer-select',
      'nozzle-select',
      'process-select',
      'layout-select',
      'preserve-temps',
    ].forEach((id) => {
      const element = $(id);
      if (element) element.disabled = busy;
    });

    const layout = $('layout-select');
    if (layout) layout.value = state.options.layout;
    const preserve = $('preserve-temps');
    if (preserve) preserve.checked = state.options.preserveTemperatures;

    let hint = 'Select the printer and nozzle you will open in Flash Studio.';
    if (printer) {
      hint = `${printer.name || printer.id} · ${Number(printer.maxColors) || 1} colour slot${
        Number(printer.maxColors) === 1 ? '' : 's'
      }.`;
      if (printer.compatibility?.flashStudio) {
        hint += ` Target: Flash Studio ${printer.compatibility.flashStudio}.`;
      }
    }
    setText('target-hint', hint);
  }

  function renderColors() {
    const analysis = state.view?.analysis;
    const used = usedColors();
    const printer = selectedPrinter();
    const panel = $('colors-panel');
    if (!analysis || !printer || used.length === 0) {
      setHidden(panel, true);
      return;
    }
    setHidden(panel, false);
    const maxColors = Number(printer.maxColors) || 1;
    const keepAll = keepAllAvailable();
    if (!keepAll) state.options.keepAllColors = false;
    setText('color-count', `${used.length} ${used.length === 1 ? 'COLOUR' : 'COLOURS'}`);
    setHidden('keep-all-row', !keepAll);
    const keepAllInput = $('keep-all-colors');
    if (keepAllInput) {
      keepAllInput.checked = Boolean(keepAll && state.options.keepAllColors);
      keepAllInput.disabled = Boolean(state.view?.busy);
    }

    const slots = targetSlotCount();
    const list = $('colors-list');
    if (!list) return;
    list.replaceChildren();

    if (maxColors === 1) {
      const note = document.createElement('div');
      note.className = 'single-color-note';
      const title = document.createElement('strong');
      title.textContent = 'Single-colour target';
      const detail = document.createElement('span');
      detail.textContent =
        'All painted colours and per-object extruders collapse to slot 1. The first used filament is shown here.';
      note.append(title, detail);
      list.append(note);
    }

    const displayColors = maxColors === 1 ? used.slice(0, 1) : used;
    displayColors.forEach((color) => {
      const slot = Number(color.slot);
      const row = document.createElement('div');
      row.className = 'color-row';
      row.append(makeSwatch(color.color));

      const meta = document.createElement('div');
      meta.className = 'color-meta';
      const name = document.createElement('div');
      name.className = 'color-name';
      name.textContent = `${color.type || 'Filament'} · slot ${slot}`;
      const sub = document.createElement('div');
      sub.className = 'color-sub';
      sub.textContent = `${color.name || 'Unnamed filament'} · ${color.color || 'no colour'}`;
      meta.append(name, sub);
      row.append(meta);

      const target = document.createElement('div');
      target.className = 'color-target';
      const targetValue = Number(state.mapping[String(slot)]) || 1;
      if (maxColors === 1) {
        target.textContent = '→ SLOT 1';
      } else {
        const label = document.createElement('span');
        label.textContent = 'TO';
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Target slot for source filament ${slot}`);
        select.disabled = Boolean(state.view?.busy);
        for (let index = 1; index <= slots; index += 1) {
          select.add(makeOption(`Slot ${index}`, String(index)));
        }
        select.value = String(targetValue);
        select.addEventListener('change', () => {
          state.mapping[String(slot)] = Number(select.value);
          state.mappingTouched = true;
          renderColors();
        });
        target.append(label, select);
      }
      row.append(target);

      const shared =
        maxColors === 1
          ? []
          : used.filter(
              (candidate) =>
                Number(state.mapping[String(candidate.slot)]) === targetValue &&
                Number(candidate.slot) !== slot,
            );
      if (shared.length > 0) {
        const merge = document.createElement('span');
        merge.className = 'merge-tag';
        merge.textContent = 'MERGED';
        meta.append(merge);
      }
      list.append(row);
    });

    let hint =
      'Source colours are mapped automatically. Adjust a slot if the print needs a different order.';
    if (maxColors === 1) {
      hint = 'This printer is single colour. Every source colour is merged into slot 1.';
    }
    setText('colors-hint', hint);

    const warning = $('colors-warning');
    if (warning) {
      let text = '';
      if (state.options.keepAllColors) {
        text = `Keeping ${used.length} source colours. The printer exposes ${maxColors}; verify the filament mapping in Flash Studio before slicing.`;
      } else if (used.length > maxColors) {
        text = `This project uses ${used.length} colours but ${printer.name || printer.id} exposes ${maxColors}. Similar colours may merge; review the mapping before slicing.`;
      }
      warning.textContent = text;
      warning.hidden = !text;
    }
  }

  function renderRun() {
    const view = state.view;
    const source = sourceState();
    const transfer = activeTransferState();
    const selectedMode = source.mode === 'selected';
    const busy = Boolean(view?.busy);
    const analysis = view?.analysis;
    const stale = Boolean(view?.analysisStale || analysis?.stale);
    const printer = selectedPrinter();
    const connection = view?.connection?.status || 'unknown';
    const canConvert =
      !busy &&
      !transfer &&
      Boolean(analysis) &&
      !stale &&
      Boolean(printer) &&
      Boolean(state.target.nozzle) &&
      connection === 'online';

    const convertButton = $('convert-button');
    if (convertButton) {
      convertButton.disabled = !canConvert;
      convertButton.textContent = stale ? 'Analyse again to convert' : 'Convert to Flash Studio';
    }
    const cancelButton = $('cancel-button');
    if (cancelButton) {
      setHidden(cancelButton, view?.busy !== 'convert');
      cancelButton.disabled = !view?.busy;
    }

    const progress = view?.progress || {};
    const phase = progress.phase || 'idle';
    const progressBlock = $('progress-block');
    const showProgress =
      busy ||
      [
        'preparing',
        'uploading',
        'analysing',
        'converting',
        'downloading',
        'completed',
        'error',
        'cancelled',
      ].includes(phase);
    const indeterminate = Boolean(progress.indeterminate);
    if (progressBlock) {
      progressBlock.hidden = !showProgress;
      progressBlock.dataset.phase = phase;
      progressBlock.dataset.indeterminate = String(indeterminate);
    }
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const fill = $('progress-fill');
    if (fill) fill.style.width = indeterminate ? '100%' : `${percent}%`;
    setText('progress-percent', indeterminate ? '…' : `${percent}%`);
    setText('progress-stage', progress.stage || 'Preparing');
    let progressMessage = progress.message || '';
    if (!indeterminate && ['uploading', 'downloading'].includes(phase)) {
      const completedBytes = Number(progress.completedBytes);
      const totalBytes = Number(progress.totalBytes);
      if (Number.isFinite(completedBytes) && Number.isFinite(totalBytes) && totalBytes > 0) {
        progressMessage = `${formatBytes(completedBytes)} / ${formatBytes(totalBytes)}${
          progressMessage ? ` · ${progressMessage}` : ''
        }`;
      }
    }
    if (indeterminate && !progressMessage) progressMessage = 'Waiting for the converter…';
    setText('progress-message', progressMessage);

    let busyLabel = '';
    if (view?.busy === 'convert') busyLabel = 'CONVERTING';
    else if (view?.busy === 'analyze') busyLabel = 'ANALYSING';
    if (phase === 'cancelling') busyLabel = 'CANCELLING';
    setText('busy-label', busyLabel);

    let hint;
    if (connection === 'offline') {
      hint = 'The FF-3MF instance is offline. Open Settings to check the URL and token.';
    } else if (connection === 'auth-required') {
      hint = 'The FF-3MF instance requires a valid API token. Open Settings to add one.';
    } else if (connection === 'checking') {
      hint = 'Checking the FF-3MF connection…';
    } else if (!printer) {
      hint = 'Connect to FF-3MF and choose a target printer.';
    } else if (selectedMode && transfer) {
      hint = 'Wait for the selected file to finish transferring.';
    } else if (selectedMode && !source.selectedFile) {
      hint = 'Choose a .3mf file to use as the conversion source.';
    } else if (stale) {
      hint = 'The project changed after it was analysed. Analyse it again before converting.';
    } else if (!analysis) {
      hint = selectedMode
        ? 'Upload and analyse the selected file to load its colours and enable conversion.'
        : 'Upload and analyse the project to load its colours and enable conversion.';
    } else if (busy) {
      hint = progress.stage || 'Working…';
    } else {
      hint =
        'Source analysed and ready. Convert builds the Flash Studio project without uploading it again.';
    }
    setText('run-hint', hint);

    const output = state.draft.outputDir || view?.config?.outputDir || '';
    const destination = output ? `the configured output folder` : 'the plugin data folder';
    setText(
      'run-privacy',
      `Source data is sent only to ${hostFromUrl(view?.config?.apiUrl)}. Converted projects are saved in ${destination}.`,
    );

    const analyzeButton = $('analyze-button');
    if (analyzeButton) {
      analyzeButton.disabled =
        busy ||
        Boolean(transfer) ||
        connection === 'offline' ||
        connection === 'auth-required' ||
        (selectedMode && !source.selectedFile);
    }
  }

  function renderResult() {
    const view = state.view;
    const result = view?.result;
    const panel = $('result-panel');
    if (!result) {
      setHidden(panel, true);
      return;
    }
    setHidden(panel, false);
    const printer = printerList().find((item) => item.id === result.target?.printerId);
    const targetParts = [];
    targetParts.push(printer?.name || result.target?.printerId || 'FlashForge');
    if (result.target?.nozzle) targetParts.push(`${result.target.nozzle} mm`);
    targetParts.push(result.target?.processName || 'Auto process');
    setText('result-target', targetParts.join(' · '));
    setText('result-output', result.outputPath || result.outputName || '--');
    setText('result-size', formatBytes(result.outputSize));
    setText('result-report', result.reportPath || 'Not available');

    const stats = $('result-stats');
    if (stats) {
      stats.replaceChildren();
      const reportStats = result.report?.stats || {};
      const entries = [
        ['KEPT', reportStats.settingsKept],
        ['CHANGED', reportStats.settingsChanged],
        ['DROPPED', reportStats.settingsDropped],
        ['TIME', formatDuration(reportStats.durationMs)],
      ];
      entries.forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'stat';
        const name = document.createElement('span');
        name.textContent = label;
        const valueElement = document.createElement('strong');
        valueElement.textContent = value === undefined || value === null ? '--' : String(value);
        item.append(name, valueElement);
        stats.append(item);
      });
    }

    const warningList = $('result-warnings');
    if (warningList) {
      warningList.replaceChildren();
      const warnings = Array.isArray(result.report?.warnings) ? result.report.warnings : [];
      warnings.forEach((warning) => {
        const item = document.createElement('div');
        item.textContent = warning;
        warningList.append(item);
      });
    }

    const filamentList = $('result-filaments');
    if (filamentList) {
      filamentList.replaceChildren();
      const filaments = Array.isArray(result.report?.filaments) ? result.report.filaments : [];
      filaments.forEach((filament) => {
        const row = document.createElement('div');
        row.className = 'filament-row';
        row.append(makeSwatch(filament.sourceColor || filament.targetColor));
        const text = document.createElement('div');
        text.textContent = `${filament.sourceType || 'Filament'} slot ${filament.sourceSlot} → ${filament.targetType || 'target'} slot ${filament.targetSlot}`;
        const meta = document.createElement('code');
        meta.textContent = `${filament.targetPreset || 'target preset'}${filament.merged ? ' · merged' : ''}`;
        row.append(text, meta);
        filamentList.append(row);
      });
    }

    const openOutput = $('open-output');
    if (openOutput) openOutput.disabled = false;
    const convertAgain = $('convert-again');
    if (convertAgain) convertAgain.disabled = Boolean(view?.busy);
  }

  function renderSettings() {
    const view = state.view;
    const panel = $('settings-panel');
    if (!panel) return;
    panel.hidden = !state.settingsOpen;
    const apiInput = $('settings-api-url');
    const outputInput = $('settings-output-dir');
    if (apiInput && document.activeElement !== apiInput) {
      apiInput.value = state.draft.apiUrl || '';
    }
    if (outputInput && document.activeElement !== outputInput) {
      outputInput.value = state.draft.outputDir || '';
    }
    const tokenState = $('settings-token-state');
    if (tokenState) {
      let message = view?.auth?.configured
        ? 'A token is saved. Leave the field blank to keep it.'
        : 'No token saved. Local instances usually do not need one.';
      if (state.tokenAction === 'clear') message = 'The saved token will be cleared when you save.';
      else if (($('settings-token')?.value || '').length > 0) {
        message = 'A new token will be saved with these settings.';
      }
      tokenState.textContent = message;
    }
    const clearToken = $('clear-token');
    if (clearToken) {
      clearToken.disabled =
        !view || Boolean(view?.busy) || !view?.auth?.configured || state.tokenAction === 'clear';
    }
    const save = $('save-settings');
    const test = $('test-connection');
    if (save) save.disabled = !view || Boolean(view?.busy);
    if (test) test.disabled = !view || Boolean(view?.busy);

    let privacy =
      "The token is stored in OrcaSlicer's plugin data folder and is never sent to the page again.";
    try {
      const parsed = new URL(state.draft.apiUrl || '');
      if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
        privacy = 'This is a non-local HTTP connection. Use HTTPS or a trusted private network.';
      }
    } catch {
      // The Python side reports an invalid URL.
    }
    setText('settings-privacy', privacy);
  }

  function renderBanners() {
    const view = state.view;
    const error = state.localError || view?.error || null;
    const warning = error && isNoticeCode(error.code) ? error : null;
    const connection = view?.connection || {};
    const noticeText =
      warning?.message || (connection.status === 'auth-required' ? connection.message : '') || '';
    const noticeKey = warning
      ? `warning:${warning.code}:${warning.message}`
      : `connection:${noticeText}`;
    const notice = $('notice-banner');
    if (notice) {
      const show = Boolean(noticeText) && state.dismissedNotice !== noticeKey;
      notice.hidden = !show;
      setText('notice-message', noticeText);
      notice.dataset.key = noticeKey;
    }

    const errorKey = error ? `${error.code}:${error.message}` : '';
    const showError = Boolean(error) && !warning && state.dismissedError !== errorKey;
    const banner = $('error-banner');
    if (banner) {
      banner.hidden = !showError;
      setText('error-title', error?.code === 'CANCELLED' ? 'Cancelled' : 'Could not continue');
      setText('error-message', error?.message || '');
      const details = Array.isArray(error?.details) ? error.details : [];
      setHidden('error-details-wrap', details.length === 0);
      const list = $('error-details');
      if (list) {
        list.replaceChildren();
        details.forEach((detail) => {
          const item = document.createElement('li');
          item.textContent = String(detail);
          list.append(item);
        });
      }
      banner.dataset.key = errorKey;
    }
  }

  function renderAll() {
    if (!state.view) return;
    ensureTargets();
    ensureMapping();
    renderConnection();
    renderProject();
    renderTargets();
    renderColors();
    renderRun();
    renderResult();
    renderSettings();
    renderBanners();
    setText('footer-version', `FF-3MF plugin v${state.view.meta?.pluginVersion || '--'}`);
    setText(
      'footer-orca',
      state.view.meta?.orcaVersion ? `OrcaSlicer ${state.view.meta.orcaVersion}` : 'OrcaSlicer --',
    );
  }

  function openSettings() {
    state.settingsOpen = true;
    state.draft.apiUrl = state.view?.config?.apiUrl || '';
    state.draft.outputDir = state.view?.config?.outputDir || '';
    state.draftDirty = false;
    state.tokenAction = 'keep';
    const token = $('settings-token');
    if (token) token.value = '';
    renderSettings();
  }

  function closeSettings() {
    state.settingsOpen = false;
    renderSettings();
  }

  function settingsPayload() {
    const tokenValue = $('settings-token')?.value || '';
    let token;
    if (state.tokenAction === 'clear') token = { action: 'clear' };
    else if (tokenValue.trim()) token = { action: 'set', value: tokenValue.trim() };
    else token = { action: 'keep' };
    return {
      config: {
        apiUrl: ($('settings-api-url')?.value || state.draft.apiUrl || '')
          .trim()
          .replace(/\/+$/, ''),
        outputDir: ($('settings-output-dir')?.value || '').trim(),
      },
      token,
    };
  }

  function bindEvents() {
    $('connection-pill')?.addEventListener('click', () => post({ type: 'refresh' }));

    const retryOfflineConnection = () => {
      if (document.visibilityState !== 'hidden' && state.view?.connection?.status === 'offline') {
        post({ type: 'refresh' });
      }
    };
    window.addEventListener('focus', retryOfflineConnection);
    document.addEventListener('visibilitychange', retryOfflineConnection);

    $('preview-prev')?.addEventListener('click', () => previewStep(-1));
    $('preview-next')?.addEventListener('click', () => previewStep(1));
    $('preview-carousel')?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        previewStep(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        previewStep(1);
      }
    });

    $('source-current')?.addEventListener('click', () => {
      if (state.view?.busy || state.fileTransfer) return;
      abortLocalTransfer();
      state.localError = null;
      renderBanners();
      post({ type: 'set-source', source: 'current' });
    });

    $('source-file')?.addEventListener('click', () => {
      if (state.view?.busy || state.fileTransfer) return;
      state.localError = null;
      renderBanners();
      post({ type: 'set-source', source: 'selected' });
    });

    $('choose-file-button')?.addEventListener('click', () => $('file-source-input')?.click());

    $('file-source-input')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) startFileTransfer(file);
    });

    $('clear-selected-file')?.addEventListener('click', () => {
      abortLocalTransfer();
      state.localError = null;
      renderBanners();
      post({ type: 'clear-selected-file' });
    });

    $('analyze-button')?.addEventListener('click', () => {
      state.localError = null;
      state.dismissedError = '';
      state.dismissedNotice = '';
      renderBanners();
      post({ type: 'analyze' });
    });

    $('convert-button')?.addEventListener('click', () => {
      state.localError = null;
      state.dismissedError = '';
      state.dismissedNotice = '';
      renderBanners();
      post({ type: 'convert', target: currentTarget(), options: currentOptions() });
    });

    $('cancel-button')?.addEventListener('click', () => post({ type: 'cancel' }));
    $('open-output')?.addEventListener('click', () => post({ type: 'open-output' }));
    $('open-project-folder')?.addEventListener('click', () =>
      post({ type: 'open-project-folder' }),
    );
    $('clear-result')?.addEventListener('click', () => post({ type: 'clear-result' }));
    $('convert-again')?.addEventListener('click', () => {
      state.dismissedError = '';
      post({ type: 'analyze' });
    });

    $('printer-select')?.addEventListener('change', (event) => {
      state.target.printerId = event.target.value;
      state.target.nozzle = '';
      state.target.processName = '';
      state.mappingTouched = false;
      ensureTargets();
      ensureMapping();
      renderAll();
    });

    $('nozzle-select')?.addEventListener('change', (event) => {
      state.target.nozzle = event.target.value;
      state.target.processName = '';
      state.mappingTouched = false;
      ensureTargets();
      ensureMapping();
      renderAll();
    });

    $('process-select')?.addEventListener('change', (event) => {
      state.target.processName = event.target.value;
      renderRun();
    });

    $('layout-select')?.addEventListener('change', (event) => {
      state.options.layout = event.target.value;
    });

    $('preserve-temps')?.addEventListener('change', (event) => {
      state.options.preserveTemperatures = event.target.checked;
    });

    $('keep-all-colors')?.addEventListener('change', (event) => {
      state.options.keepAllColors = event.target.checked && keepAllAvailable();
      state.mappingTouched = false;
      ensureMapping();
      renderColors();
      renderRun();
    });

    $('toggle-settings')?.addEventListener('click', () => {
      if (state.settingsOpen) closeSettings();
      else openSettings();
    });
    $('close-settings')?.addEventListener('click', closeSettings);

    $('settings-api-url')?.addEventListener('input', (event) => {
      state.draft.apiUrl = event.target.value;
      state.draftDirty = true;
      renderSettings();
    });
    $('settings-output-dir')?.addEventListener('input', (event) => {
      state.draft.outputDir = event.target.value;
      state.draftDirty = true;
      renderSettings();
    });
    $('settings-token')?.addEventListener('input', () => {
      if (state.tokenAction === 'clear') state.tokenAction = 'keep';
      renderSettings();
    });

    $('save-settings')?.addEventListener('click', () => {
      const payload = settingsPayload();
      state.draft.apiUrl = payload.config.apiUrl;
      state.draft.outputDir = payload.config.outputDir;
      state.tokenAction = 'keep';
      const tokenInput = $('settings-token');
      if (tokenInput) tokenInput.value = '';
      post({ type: 'save-settings', ...payload });
    });

    $('test-connection')?.addEventListener('click', () => {
      const payload = settingsPayload();
      post({
        type: 'test-connection',
        config: payload.config,
        token: payload.token,
      });
    });

    $('clear-token')?.addEventListener('click', () => {
      state.tokenAction = 'keep';
      const tokenInput = $('settings-token');
      if (tokenInput) tokenInput.value = '';
      post({ type: 'clear-token' });
    });

    $('reset-output')?.addEventListener('click', () => {
      state.draft.outputDir = '';
      state.draftDirty = true;
      const input = $('settings-output-dir');
      if (input) input.value = '';
      renderSettings();
    });

    $('dismiss-error')?.addEventListener('click', () => {
      state.localError = null;
      state.dismissedError = $('error-banner')?.dataset.key || '';
      renderBanners();
    });
    $('dismiss-notice')?.addEventListener('click', () => {
      state.dismissedNotice = $('notice-banner')?.dataset.key || '';
      renderBanners();
    });
  }

  function connectBridge(attempt = 0) {
    if (window.orca && typeof window.orca.onMessage === 'function') {
      window.orca.onMessage(handleMessage);
      post({ type: 'ready' });
      return;
    }
    if (attempt < 100) {
      window.setTimeout(() => connectBridge(attempt + 1), 25);
      return;
    }
    const banner = $('error-banner');
    if (banner) {
      banner.hidden = false;
      setText('error-title', 'Open this tab inside OrcaSlicer');
      setText(
        'error-message',
        'The OrcaSlicer plugin bridge is not available. Install the plugin through the Plugins dialog and reopen the tab.',
      );
    }
  }

  function init() {
    bindEvents();
    connectBridge();
  }

  init();
})();
