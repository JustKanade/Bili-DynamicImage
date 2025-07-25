class BilibiliDownloader {
    constructor() {
        this.isDownloading = false;
        this.downloadStopped = false;
        this.settings = {};
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.bindEvents();
        await this.checkCurrentPage();
        await this.checkAutoExpandSettings();
    }

    // Load user settings
    async loadSettings() {
        const defaultSettings = {
            fileNamePattern: '{original}.{ext}',
            downloadPath: 'BiliDynamic',
            skipReference: true,
            skipDownloaded: true,
            downloadInterval: 2,
            retryLimit: 3,
            maxDownloads: 100
        };

        try {
            const result = await chrome.storage.local.get('bilibiliDownloaderSettings');
            this.settings = { ...defaultSettings, ...result.bilibiliDownloaderSettings };
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = defaultSettings;
        }

        this.updateUI();
    }

    // Save user settings
    async saveSettings() {
        try {
            await chrome.storage.local.set({ bilibiliDownloaderSettings: this.settings });
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    // Update UI with current settings
    updateUI() {
        document.getElementById('fileNamePattern').value = this.settings.fileNamePattern;
        document.getElementById('downloadPath').value = this.settings.downloadPath || '';
        document.getElementById('skipReference').checked = this.settings.skipReference;
        document.getElementById('skipDownloaded').checked = this.settings.skipDownloaded;
        document.getElementById('downloadInterval').value = this.settings.downloadInterval;
        document.getElementById('retryLimit').value = this.settings.retryLimit;
        document.getElementById('maxDownloads').value = this.settings.maxDownloads;
    }

    // Bind event handlers
    bindEvents() {
        document.getElementById('downloadBtn').addEventListener('click', () => {
            this.startDownload();
        });

        document.getElementById('stopBtn').addEventListener('click', () => {
            this.stopDownload();
        });

        document.getElementById('settingsToggle').addEventListener('click', () => {
            this.toggleSettings();
        });

        // GitHub link handler
        document.getElementById('githubLink').addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: 'https://github.com/JustKanade/Bili-DynamicImage' });
        });

        // Settings change handlers
        document.getElementById('fileNamePattern').addEventListener('change', (e) => {
            this.settings.fileNamePattern = e.target.value;
            this.saveSettings();
        });

        document.getElementById('downloadPath').addEventListener('change', (e) => {

            let path = e.target.value.trim();
            

            path = path.replace(/\\/g, '/');
            

            if (path.startsWith('/')) {
                path = path.substring(1);
            }
            

            path = path.replace(/[<>:"|?*]/g, '_');
            
            this.settings.downloadPath = path;
            e.target.value = path; 
            this.saveSettings();
        });

        document.getElementById('skipReference').addEventListener('change', (e) => {
            this.settings.skipReference = e.target.checked;
            this.saveSettings();
        });

        document.getElementById('skipDownloaded').addEventListener('change', (e) => {
            this.settings.skipDownloaded = e.target.checked;
            this.saveSettings();
        });

        document.getElementById('downloadInterval').addEventListener('change', (e) => {
            this.settings.downloadInterval = parseInt(e.target.value);
            this.saveSettings();
        });

        document.getElementById('retryLimit').addEventListener('change', (e) => {
            this.settings.retryLimit = parseInt(e.target.value);
            this.saveSettings();
        });

        document.getElementById('maxDownloads').addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            

            if (isNaN(value) || value < 0) {
                value = 100; 
            } else if (value > 1000) {
                value = 1000; 
            }
            
            this.settings.maxDownloads = value;
            e.target.value = value;
            this.saveSettings();
        });

        
        const formatButtons = document.querySelectorAll('.format-btn');
        formatButtons.forEach(button => {
            button.addEventListener('click', () => {
                const format = button.getAttribute('data-format');
                if (format) {
                    const fileNameInput = document.getElementById('fileNamePattern');
                    fileNameInput.value = format;

                    this.settings.fileNamePattern = format;
                    this.saveSettings();
                }
            });
        });

        // Listen for background script messages
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message);
        });
    }

    // Handle messages from background script and content script
    handleMessage(message) {
        switch (message.type) {
            case 'downloadProgress':
                this.updateProgress(message.data);
                break;
            case 'downloadComplete':
                this.downloadComplete(message.data);
                break;
            case 'downloadError':
                this.showError(message.data);
                break;
            case 'openSettings':
                // Open settings popup when clicked from sidebar
                this.openPopupSettings();
                break;
        }
    }

    // Open settings panel from sidebar button
    openPopupSettings() {
        const settingsContent = document.getElementById('settingsContent');
        const settingsToggle = document.getElementById('settingsToggle');
        
        // Show settings if hidden
        if (settingsContent.style.display === 'none') {
            settingsContent.style.display = 'block';
            settingsToggle.classList.add('expanded');
        }
    }

    // Check current page compatibility
    async checkCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const url = tab.url;
            
            if (url.includes('t.bilibili.com') || url.includes('space.bilibili.com')) {
                this.setStatus('当前页面支持下载');
                document.getElementById('downloadBtn').disabled = false;
            } else {
                this.setStatus('请打开B站动态页面');
                document.getElementById('downloadBtn').disabled = true;
            }
        } catch (error) {
            console.error('Failed to check page:', error);
            this.setStatus('无法检测当前页面');
        }
    }

    // Check content script connection with retry mechanism
    async checkContentScriptConnection(tabId, maxRetries = 5) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                this.setStatus(`正在连接页面脚本... (${i + 1}/${maxRetries})`);
                
                const response = await chrome.tabs.sendMessage(tabId, {
                    type: 'ping'
                });
                
                if (response && response.success) {
                    this.setStatus('连接成功，正在扫描动态...');
                    return true;
                }
            } catch (error) {
                console.log(`Connection attempt ${i + 1} failed:`, error.message);
                
                if (i < maxRetries - 1) {
                    await this.sleep(1);
                }
            }
        }
        
        return false;
    }

    // Start download process
    async startDownload() {
        if (this.isDownloading) return;

        try {
            this.isDownloading = true;
            this.downloadStopped = false;
            this.showProgress();

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Check content script connection
            const connected = await this.checkContentScriptConnection(tab.id);
            
            if (!connected) {
                throw new Error('无法连接到页面脚本，请刷新页面后重试。');
            }
            
            this.setStatus('正在扫描页面动态...');
            const response = await this.sendMessageWithTimeout(tab.id, {
                type: 'getDynamics',
                settings: this.settings
            }, 10000);

            if (response && response.success) {
                if (response.dynamics.length === 0) {
                    this.setStatus('未找到可下载的动态');
                    this.hideProgress();
                    this.isDownloading = false;
                    return;
                }

                chrome.runtime.sendMessage({
                    type: 'startDownload',
                    dynamics: response.dynamics,
                    settings: this.settings
                });

                this.setStatus(`找到 ${response.dynamics.length} 条动态，开始下载...`);
            } else {
                throw new Error('获取动态列表失败: ' + (response?.error || '未知错误'));
            }
        } catch (error) {
            console.error('Download failed:', error);
            let errorMessage = error.message;
            
            // Provide user-friendly error messages
            if (errorMessage.includes('Could not establish connection')) {
                errorMessage = '无法连接到页面，请刷新后重试';
            } else if (errorMessage.includes('Receiving end does not exist')) {
                errorMessage = '页面脚本未就绪，请刷新后重试';
            }
            
            this.showError(errorMessage);
            this.hideProgress();
            this.isDownloading = false;
        }
    }

    // Send message with timeout protection
    async sendMessageWithTimeout(tabId, message, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('消息超时'));
            }, timeout);

            chrome.tabs.sendMessage(tabId, message, (response) => {
                clearTimeout(timer);
                
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    sleep(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    stopDownload() {
        this.downloadStopped = true;
        chrome.runtime.sendMessage({ type: 'stopDownload' });
        this.setStatus('正在停止下载...');
    }

    showProgress() {
        document.getElementById('progressSection').style.display = 'block';
        document.getElementById('downloadBtn').disabled = true;
        document.getElementById('downloadBtn').classList.add('downloading');
    }

    hideProgress() {
        document.getElementById('progressSection').style.display = 'none';
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('downloadBtn').classList.remove('downloading');
    }

    updateProgress(data) {
        const { current, total, currentItem, status } = data;
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

        document.getElementById('progressFill').style.width = `${percentage}%`;
        document.getElementById('progressText').textContent = `${currentItem || '准备中...'} ${status || ''}`;
        document.getElementById('progressCount').textContent = `${current} / ${total}`;
    }

    downloadComplete(data) {
        this.isDownloading = false;
        this.hideProgress();
        
        if (data.stopped) {
            this.setStatus('下载已停止');
        } else {
            this.setStatus(`下载完成! 成功: ${data.success}, 失败: ${data.failed}`);
        }
    }

    showError(message) {
        this.setStatus('错误: ' + message);
        this.isDownloading = false;
        this.hideProgress();
    }

    setStatus(text) {
        document.getElementById('statusText').textContent = text;
    }

    toggleSettings(forceExpand = false) {
        const settingsContent = document.getElementById('settingsContent');
        const settingsToggle = document.getElementById('settingsToggle');
        
        if (forceExpand) {
            settingsContent.style.display = 'block';
            settingsToggle.classList.add('expanded');
            return;
        }
        
        if (settingsContent.style.display === 'none') {
            settingsContent.style.display = 'block';
            settingsToggle.classList.add('expanded');
        } else {
            settingsContent.style.display = 'none';
            settingsToggle.classList.remove('expanded');
        }
    }

    // Check if settings should be auto-expanded
    async checkAutoExpandSettings() {
        try {
            const result = await chrome.storage.local.get('autoExpandSettings');
            if (result.autoExpandSettings) {
                // Auto-expand settings
                this.toggleSettings(true);
                // Clear the flag
                await chrome.storage.local.remove('autoExpandSettings');
            }
        } catch (error) {
            console.error('Failed to check auto-expand settings:', error);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BilibiliDownloader();
}); 