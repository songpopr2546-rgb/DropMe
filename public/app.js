const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const resultsContainer = document.getElementById('results-container');
const maxSizeInput = document.getElementById('max-size');
const maxWidthInput = document.getElementById('max-width');
const maxHeightInput = document.getElementById('max-height');
const outputFormatSelect = document.getElementById('output-format');
const maxSizeWrapperContainer = document.getElementById('max-size-wrapper-container');
const maxBoundsWrapperContainer = document.getElementById('max-bounds-wrapper-container');
const modeTabs = document.querySelectorAll('.mode-tab');
const resultsHeader = document.getElementById('results-header');
const downloadZipBtn = document.getElementById('download-zip');

let processedFiles = [];

// Mode Toggle UI via Tabs
modeTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        modeTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        
        const selectedMode = e.target.dataset.mode;
        
        if (selectedMode === 'convert') {
            maxSizeWrapperContainer.style.display = 'none';
            maxBoundsWrapperContainer.style.display = 'block';
        } else {
            maxSizeWrapperContainer.style.display = 'flex';
            maxBoundsWrapperContainer.style.display = 'none';
        }
    });
});

// Drag and Drop Events
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', handleDrop, false);
fileInput.addEventListener('change', (e) => handleFiles(e.target.files), false);

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

function handleFiles(files) {
    const maxSize = maxSizeInput.value || 1.9;
    const maxWidth = maxWidthInput.value;
    const maxHeight = maxHeightInput.value;
    const format = outputFormatSelect.value || 'webp';
    const mode = document.querySelector('.mode-tab.active').dataset.mode || 'compress';
    
    resultsHeader.style.display = 'flex';
    
    ([...files]).forEach(file => {
        if (!file.type.match('image/')) {
            alert('Only images are supported.');
            return;
        }
        
        
        const cardId = 'card-' + Math.random().toString(36).substring(7);
        createResultCard(cardId, file);
        uploadAndCompress(file, cardId, maxSize, maxWidth, maxHeight, format, mode);
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function createResultCard(id, file) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    const card = document.createElement('div');
    card.className = 'result-card';
    card.id = id;
    
    // Initial Render (Processing State)
    card.innerHTML = `
        <img src="" class="preview-img" alt="preview" id="img-${id}">
        <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-meta" id="meta-${id}">
                <span>Initial Size: ${formatBytes(file.size)}</span>
            </div>
        </div>
        <div class="status-badge processing" id="badge-${id}">Processing...</div>
    `;
    
    resultsContainer.prepend(card);
    
    reader.onload = function(e) {
        document.getElementById(`img-${id}`).src = e.target.result;
    }
}

async function uploadAndCompress(file, cardId, maxSize, maxWidth, maxHeight, format, mode) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('maxSize', maxSize);
    formData.append('format', format);
    formData.append('mode', mode);
    if (maxWidth) formData.append('maxWidth', maxWidth);
    if (maxHeight) formData.append('maxHeight', maxHeight);

    try {
        const response = await fetch('/compress', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        const card = document.getElementById(cardId);
        const badge = document.getElementById(`badge-${cardId}`);
        const metaList = document.getElementById(`meta-${cardId}`);
        const img = document.getElementById(`img-${cardId}`);

        if (data.error) {
            badge.className = 'status-badge danger';
            badge.innerText = 'Failed';
            card.classList.add('danger');
            metaList.innerHTML += `<span style="color: var(--accent-danger)">Error: ${data.error}</span>`;
            return;
        }

        // Update with results
        img.src = data.dataUrl;
        
        let settingString = '';
        if (data.settings === 'None') settingString = 'Skipped (Already Small)';
        else settingString = `Q:${data.settings.quality} | Colors:${data.settings.colors} | Dither:${data.settings.dither !== undefined ? data.settings.dither : 1}`;

        metaList.innerHTML = `
            <span>Original: ${formatBytes(data.originalSize)}</span>
            <span style="color: var(--text-primary)">Compressed: ${formatBytes(data.finalSize)}</span>
            <span style="opacity: 0.6">${settingString}</span>
        `;

        if (data.isUnderLimit) {
            badge.className = 'status-badge success';
            badge.innerText = 'Success limit met';
            card.classList.add('success');
        } else {
            badge.className = 'status-badge warning';
            badge.innerText = 'Over target size';
            card.classList.add('warning');
        }

        // Add download button
        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'download-btn';
        downloadBtn.innerText = 'Download';
        downloadBtn.href = data.dataUrl;
        
        const ext = format === 'webp' ? 'webp' : 
                    format === 'jpeg' ? 'jpg' :
                    format === 'avif' ? 'avif' : 'png';
        const newName = file.name.replace(/\.[^/.]+$/, "") + '.' + ext;
        downloadBtn.download = `compressed_${newName}`;
        
        card.appendChild(downloadBtn);
        
        // Push to zip array
        processedFiles.push({
            name: `compressed_${newName}`,
            dataUrl: data.dataUrl
        });
        
        if (processedFiles.length > 0) {
            downloadZipBtn.style.display = 'block';
        }

    } catch (error) {
        console.error('Error:', error);
        const badge = document.getElementById(`badge-${cardId}`);
        badge.className = 'status-badge danger';
        badge.innerText = 'Error';
    }
}

// Handle ZIP Download
downloadZipBtn.addEventListener('click', async () => {
    if (processedFiles.length === 0) return;
    
    downloadZipBtn.innerText = 'Zipping...';
    downloadZipBtn.style.pointerEvents = 'none';
    downloadZipBtn.style.opacity = '0.7';
    
    const zip = new JSZip();
    
    processedFiles.forEach(file => {
        // Strip data:image/...;base64, from dataUrl
        const base64Data = file.dataUrl.split(',')[1];
        zip.file(file.name, base64Data, {base64: true});
    });
    
    const content = await zip.generateAsync({type: "blob"});
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "DropMe_Images.zip";
    link.click();
    
    downloadZipBtn.innerText = 'Download All (ZIP)';
    downloadZipBtn.style.pointerEvents = 'auto';
    downloadZipBtn.style.opacity = '1';
});
