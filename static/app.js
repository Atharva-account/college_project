const apiBase = '';

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (res.status === 200 && contentType.includes('text/html')) {
        window.location.href = '/login';
        return Promise.reject(new Error('Not authenticated'));
    }
    if (!res.ok) {
        const text = await res.text();
        if ((res.status === 401 || res.status === 403 || res.status === 302) || (contentType.includes('text/html'))) {
            window.location.href = '/login';
            return Promise.reject(new Error('Not authenticated'));
        }
        throw new Error(text || `Request failed: ${res.status}`);
    }
    return res.json();
}

function formatBytes(bytes) {
	if (bytes === 0 || bytes == null) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDate(dateStr) {
	if (!dateStr) return '';
	const d = new Date(dateStr);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString('en-US', { 
		year: 'numeric', 
		month: 'short', 
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

function getFileIcon(filename, contentType) {
	const extension = filename?.split('.').pop()?.toLowerCase();
	const type = contentType?.split('/')[0];
	
	// Documents
	if (['pdf'].includes(extension)) return 'bi-file-earmark-pdf pdf';
	if (['doc', 'docx'].includes(extension)) return 'bi-file-earmark-word doc';
	if (['xls', 'xlsx'].includes(extension)) return 'bi-file-earmark-excel xls';
	if (['ppt', 'pptx'].includes(extension)) return 'bi-file-earmark-slides';
	
	// Images
	if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'].includes(extension)) return 'bi-file-earmark-image jpg';
	if (type === 'image') return 'bi-file-earmark-image jpg';
	
	// Videos
	if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(extension)) return 'bi-file-earmark-play mp4';
	if (type === 'video') return 'bi-file-earmark-play mp4';
	
	// Audio
	if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(extension)) return 'bi-file-earmark-music mp3';
	if (type === 'audio') return 'bi-file-earmark-music mp3';
	
	// Archives
	if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'bi-file-earmark-zip zip';
	
	// Code
	if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'xml', 'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs'].includes(extension)) return 'bi-file-earmark-code';
	
	return 'bi-file-earmark default';
}

function createFileCard(file) {
	const icon = getFileIcon(file.filename, file.contentType);
	const card = document.createElement('div');
	card.className = 'file-card';
	card.innerHTML = `
		<i class="bi ${icon} file-icon"></i>
		<div class="file-name">${file.filename || 'Untitled'}</div>
		<div class="file-meta">
			<div>${formatBytes(file.length)}</div>
			<div>${formatDate(file.uploadDate)}</div>
		</div>
		<div class="file-actions">
			<a class="btn btn-outline-success btn-sm" href="${apiBase}/download/${file.id}">
				<i class="bi bi-download me-1"></i>Download
			</a>
			<button class="btn btn-outline-info btn-sm" data-share-id="${file.id}">
				<i class="bi bi-share me-1"></i>Share
			</button>
			<button class="btn btn-outline-danger btn-sm" data-id="${file.id}">
				<i class="bi bi-trash me-1"></i>Delete
			</button>
		</div>
	`;
	
	// Add delete functionality
	card.querySelector('button[data-id]')?.addEventListener('click', async (e) => {
		const id = e.currentTarget.getAttribute('data-id');
		if (!confirm('Are you sure you want to delete this file?')) return;
		try {
			await fetchJSON(`${apiBase}/delete/${id}`, { method: 'DELETE' });
			await loadFiles();
		} catch (err) {
			alert(err.message);
		}
	});
	
	// Add share functionality
	card.querySelector('button[data-share-id]')?.addEventListener('click', async (e) => {
		const id = e.currentTarget.getAttribute('data-share-id');
		try {
			const data = await fetchJSON(`${apiBase}/share/${id}`, { method: 'POST' });
			showShareModal(data.shareUrl);
		} catch (err) {
			alert('Failed to create share link: ' + err.message);
		}
	});
	
	return card;
}

async function loadFiles() {
	const container = document.getElementById('files-container');
	container.innerHTML = `
		<div class="text-center py-5">
			<div class="loading-spinner"></div>
			<p class="text-muted mt-3">Loading your files...</p>
		</div>
	`;
	
	try {
		const files = await fetchJSON(`${apiBase}/files`);
		if (!Array.isArray(files) || files.length === 0) {
			container.innerHTML = `
				<div class="text-center py-5">
					<i class="bi bi-inbox display-1 text-muted"></i>
					<p class="text-muted mt-3">No files uploaded yet.</p>
					<p class="text-muted">Upload your first file to get started!</p>
				</div>
			`;
			return;
		}
		
		container.innerHTML = '';
		files.forEach(file => {
			container.appendChild(createFileCard(file));
		});
		
	} catch (err) {
		container.innerHTML = `
			<div class="text-center py-5">
				<i class="bi bi-exclamation-triangle display-1 text-danger"></i>
				<p class="text-danger mt-3">${err.message}</p>
			</div>
		`;
	}
}

// Drag and drop functionality
function setupDragAndDrop() {
	const uploadArea = document.getElementById('upload-area');
	const fileInput = document.getElementById('file-input');
	const browseBtn = document.getElementById('browse-btn');
	const selectedFileDiv = document.getElementById('selected-file');
	const fileNameSpan = document.getElementById('file-name');
	
	// Prevent default drag behaviors
	['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
		uploadArea.addEventListener(eventName, preventDefaults, false);
		document.body.addEventListener(eventName, preventDefaults, false);
	});
	
	function preventDefaults(e) {
		e.preventDefault();
		e.stopPropagation();
	}
	
	// Highlight drop area when item is dragged over it
	['dragenter', 'dragover'].forEach(eventName => {
		uploadArea.addEventListener(eventName, highlight, false);
	});
	
	['dragleave', 'drop'].forEach(eventName => {
		uploadArea.addEventListener(eventName, unhighlight, false);
	});
	
	function highlight(e) {
		uploadArea.classList.add('dragover');
	}
	
	function unhighlight(e) {
		uploadArea.classList.remove('dragover');
	}
	
	// Handle dropped files
	uploadArea.addEventListener('drop', handleDrop, false);
	
	function handleDrop(e) {
		const dt = e.dataTransfer;
		const files = dt.files;
		
		if (files.length > 0) {
			fileInput.files = files;
			handleFileSelect(files[0]);
		}
	}
	
	// Handle file selection
	browseBtn.addEventListener('click', () => {
		fileInput.click();
	});
	
	fileInput.addEventListener('change', (e) => {
		if (e.target.files.length > 0) {
			handleFileSelect(e.target.files[0]);
		}
	});
	
	function handleFileSelect(file) {
		fileNameSpan.textContent = file.name;
		selectedFileDiv.classList.remove('d-none');
	}
}

async function onUpload(e) {
	e.preventDefault();
	const fileInput = document.getElementById('file-input');
	if (!fileInput.files || fileInput.files.length === 0) return;
	
	const formData = new FormData();
	formData.append('file', fileInput.files[0]);
	
	const button = e.target.querySelector('button[type="submit"]');
	const originalText = button.innerHTML;
	button.disabled = true;
	button.innerHTML = '<div class="loading-spinner me-2"></div>Uploading...';
	
	try {
		await fetchJSON(`${apiBase}/upload`, { method: 'POST', body: formData });
		fileInput.value = '';
		document.getElementById('selected-file').classList.add('d-none');
		await loadFiles();
	} catch (err) {
		alert(err.message);
	} finally {
		button.disabled = false;
		button.innerHTML = originalText;
	}
}

// Share modal functionality
let shareModalInstance = null;

function formatBytes(bytes) {
	if (bytes === 0 || bytes == null) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function showShareModal(shareUrl) {
	const modal = document.getElementById('shareModal');
	const input = document.getElementById('shareLinkInput');
	const successDiv = document.getElementById('shareSuccess');
	
	input.value = shareUrl;
	successDiv.classList.add('d-none');
	
	if (!shareModalInstance) {
		shareModalInstance = new bootstrap.Modal(modal);
	}
	shareModalInstance.show();
}

function setupShareModal() {
	const copyBtn = document.getElementById('copyShareBtn');
	const successDiv = document.getElementById('shareSuccess');
	
	copyBtn.addEventListener('click', async () => {
		const input = document.getElementById('shareLinkInput');
		try {
			await navigator.clipboard.writeText(input.value);
			successDiv.classList.remove('d-none');
			setTimeout(() => successDiv.classList.add('d-none'), 3000);
		} catch (err) {
			// Fallback: select and copy
			input.select();
			document.execCommand('copy');
			successDiv.classList.remove('d-none');
			setTimeout(() => successDiv.classList.add('d-none'), 3000);
		}
	});
}

// Profile modal functionality
async function loadUserStats() {
	try {
		const stats = await fetchJSON(`${apiBase}/stats`);
		
		// Update file counts
		document.getElementById('totalFiles').textContent = stats.fileCount;
		document.getElementById('sharedFiles').textContent = stats.sharedCount;
		
		// Update storage bar
		const storageBar = document.getElementById('storageBar');
		const storageText = document.getElementById('storageText');
		const usedStorage = document.getElementById('usedStorage');
		const totalStorage = document.getElementById('totalStorage');
		
		storageBar.style.width = `${Math.min(stats.usagePercent, 100)}%`;
		storageText.textContent = `${stats.usagePercent}% used`;
		usedStorage.textContent = `${formatBytes(stats.totalSize)} used`;
		totalStorage.textContent = `of ${formatBytes(stats.storageLimit)}`;
		
		// Change color if usage is high
		if (stats.usagePercent > 90) {
			storageBar.classList.remove('bg-gradient-storage');
			storageBar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
		} else if (stats.usagePercent > 70) {
			storageBar.classList.remove('bg-gradient-storage');
			storageBar.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
		}
		
	} catch (err) {
		console.error('Failed to load stats:', err);
		document.getElementById('storageText').textContent = 'Failed to load';
	}
}

function setupProfileModal() {
	const profileModal = document.getElementById('profileModal');
	const upgradeBtn = document.getElementById('upgradeBtn');
	
	// Listen for modal show event
	if (profileModal) {
		profileModal.addEventListener('show.bs.modal', () => {
			loadUserStats();
		});
	}
	
	if (upgradeBtn) {
		upgradeBtn.addEventListener('click', () => {
			alert('Upgrade feature coming soon! Contact admin for premium plans.');
		});
	}
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
	setupDragAndDrop();
	setupShareModal();
	loadFiles();
});

document.getElementById('upload-form').addEventListener('submit', onUpload);
document.getElementById('refresh-btn').addEventListener('click', loadFiles);


