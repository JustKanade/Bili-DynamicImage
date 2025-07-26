class BilibiliDownloader {
    constructor() {
        this.isDownloading = false;
        this.downloadStopped = false;
        this.settings = {};
        this.filterPresets = [];
        this.init();
    }

    async init() {
        await this.loadSettings();
        await this.loadFilterPresets();
        this.bindEvents();
        await this.checkCurrentPage();
        await this.checkAutoExpandSettings();
        await this.checkAutoScrollStatus();
        this.setupMessageListener();
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
            maxDownloads: 100,
            // Filter settings
            filters: {
                startDate: '',
                endDate: '',
                includeKeywords: '',
                excludeKeywords: '',
                caseSensitive: false,
                exactMatch: false,
                minImageCount: '',
                maxImageCount: '',
                dynamicTypes: {
                    normal: true,
                    repost: true,
                    video: true,
                    article: true
                }
            },
            // Auto scroll settings
            autoScroll: {
                scrollSpeed: 500,
                scrollInterval: 1000,
                smoothScroll: true,
                autoScrollToTop: false,
                scrollDuration: 0
            }
        };

        try {
            const result = await chrome.storage.local.get('bilibiliDownloaderSettings');
            this.settings = { ...defaultSettings, ...result.bilibiliDownloaderSettings };
            
            // Ensure filters object exists
            if (!this.settings.filters) {
                this.settings.filters = defaultSettings.filters;
            }
            
            // Ensure dynamicTypes exists
            if (!this.settings.filters.dynamicTypes) {
                this.settings.filters.dynamicTypes = defaultSettings.filters.dynamicTypes;
            }
            
            // Migrate old keywords setting to new format
            if (this.settings.filters.keywords && !this.settings.filters.includeKeywords) {
                this.settings.filters.includeKeywords = this.settings.filters.keywords;
                delete this.settings.filters.keywords;
            }
            
            // Ensure new keyword settings exist
            if (this.settings.filters.includeKeywords === undefined) {
                this.settings.filters.includeKeywords = '';
            }
            if (this.settings.filters.excludeKeywords === undefined) {
                this.settings.filters.excludeKeywords = '';
            }
            if (this.settings.filters.caseSensitive === undefined) {
                this.settings.filters.caseSensitive = false;
            }
            if (this.settings.filters.exactMatch === undefined) {
                this.settings.filters.exactMatch = false;
            }
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

    // Load filter presets
    async loadFilterPresets() {
        try {
            const result = await chrome.storage.local.get('bilibiliFilterPresets');
            this.filterPresets = result.bilibiliFilterPresets || [];
            this.updatePresetSelector();
        } catch (error) {
            console.error('Failed to load filter presets:', error);
            this.filterPresets = [];
        }
    }

    // Save filter presets
    async saveFilterPresets() {
        try {
            await chrome.storage.local.set({ bilibiliFilterPresets: this.filterPresets });
            this.updatePresetSelector();
        } catch (error) {
            console.error('Failed to save filter presets:', error);
        }
    }

    // Update preset selector dropdown
    updatePresetSelector() {
        const selector = document.getElementById('presetSelector');
        // Clear existing options except the first one
        while (selector.options.length > 1) {
            selector.remove(1);
        }
        
        // Add presets to selector
        this.filterPresets.forEach((preset, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = preset.name;
            selector.appendChild(option);
        });
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
        
        // Update filter settings
        const filters = this.settings.filters;
        document.getElementById('startDate').value = filters.startDate || '';
        document.getElementById('endDate').value = filters.endDate || '';
        document.getElementById('includeKeywords').value = filters.includeKeywords || '';
        document.getElementById('excludeKeywords').value = filters.excludeKeywords || '';
        document.getElementById('caseSensitive').checked = filters.caseSensitive || false;
        document.getElementById('exactMatch').checked = filters.exactMatch || false;
        document.getElementById('minImageCount').value = filters.minImageCount || '';
        document.getElementById('maxImageCount').value = filters.maxImageCount || '';
        
        // Update dynamic type checkboxes
        document.getElementById('typeNormal').checked = filters.dynamicTypes.normal;
        document.getElementById('typeRepost').checked = filters.dynamicTypes.repost;
        document.getElementById('typeVideo').checked = filters.dynamicTypes.video;
        document.getElementById('typeArticle').checked = filters.dynamicTypes.article;
        
        // Update auto scroll settings
        const autoScroll = this.settings.autoScroll;
        document.getElementById('scrollSpeed').value = autoScroll.scrollSpeed || 500;
        document.getElementById('scrollInterval').value = autoScroll.scrollInterval || 1000;
        document.getElementById('smoothScroll').checked = autoScroll.smoothScroll !== false;
        document.getElementById('autoScrollToTop').checked = autoScroll.autoScrollToTop || false;
        document.getElementById('scrollDuration').value = autoScroll.scrollDuration || 0;
    }

    // Bind event handlers
    bindEvents() {
        document.getElementById('downloadBtn').addEventListener('click', () => {
            this.startDownload();
        });

        document.getElementById('stopBtn').addEventListener('click', () => {
            this.stopDownload();
        });

        document.getElementById('autoScrollSwitch').addEventListener('change', async (e) => {
            if (e.target.checked) {
                this.startAutoScroll();
            } else {
                this.stopAutoScroll();
            }
        });

        document.getElementById('settingsToggle').addEventListener('click', () => {
            this.toggleSettings();
        });
        
        // Filter toggle
        document.getElementById('filterToggle').addEventListener('click', () => {
            this.toggleFilter();
        });
        
        // Auto scroll settings toggle
        document.getElementById('autoScrollSettingsToggle').addEventListener('click', () => {
            this.toggleAutoScrollSettings();
        });
        
        // Auto scroll settings button
        document.getElementById('autoScrollSettings').addEventListener('click', () => {
            this.openAutoScrollSettings();
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
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 1) value = 1;
            if (value > 10) value = 10;
            this.settings.downloadInterval = value;
            e.target.value = value;
            this.saveSettings();
        });

        document.getElementById('retryLimit').addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 10) value = 10;
            this.settings.retryLimit = value;
            e.target.value = value;
            this.saveSettings();
        });

        document.getElementById('maxDownloads').addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 1000) value = 1000;
            this.settings.maxDownloads = value;
            e.target.value = value;
            this.saveSettings();
        });
        
        // Filter settings event handlers
        document.getElementById('startDate').addEventListener('change', (e) => {
            this.settings.filters.startDate = e.target.value;
            this.saveSettings();
        });
        
        document.getElementById('endDate').addEventListener('change', (e) => {
            this.settings.filters.endDate = e.target.value;
            this.saveSettings();
        });
        
        // New keyword filter event handlers
        document.getElementById('includeKeywords').addEventListener('change', (e) => {
            this.settings.filters.includeKeywords = e.target.value;
            this.saveSettings();
        });
        
        document.getElementById('excludeKeywords').addEventListener('change', (e) => {
            this.settings.filters.excludeKeywords = e.target.value;
            this.saveSettings();
        });
        
        document.getElementById('caseSensitive').addEventListener('change', (e) => {
            this.settings.filters.caseSensitive = e.target.checked;
            this.saveSettings();
        });
        
        document.getElementById('exactMatch').addEventListener('change', (e) => {
            this.settings.filters.exactMatch = e.target.checked;
            this.saveSettings();
        });
        
        document.getElementById('minImageCount').addEventListener('change', (e) => {
            let value = e.target.value ? parseInt(e.target.value) : '';
            this.settings.filters.minImageCount = value;
            this.saveSettings();
        });
        
        document.getElementById('maxImageCount').addEventListener('change', (e) => {
            let value = e.target.value ? parseInt(e.target.value) : '';
            this.settings.filters.maxImageCount = value;
            this.saveSettings();
        });
        
        // Dynamic type checkbox handlers
        document.getElementById('typeNormal').addEventListener('change', (e) => {
            this.settings.filters.dynamicTypes.normal = e.target.checked;
            this.saveSettings();
        });
        
        document.getElementById('typeRepost').addEventListener('change', (e) => {
            this.settings.filters.dynamicTypes.repost = e.target.checked;
            this.saveSettings();
        });
        
        document.getElementById('typeVideo').addEventListener('change', (e) => {
            this.settings.filters.dynamicTypes.video = e.target.checked;
            this.saveSettings();
        });
        
        document.getElementById('typeArticle').addEventListener('change', (e) => {
            this.settings.filters.dynamicTypes.article = e.target.checked;
            this.saveSettings();
        });
        
        // Auto scroll settings event handlers
        document.getElementById('scrollSpeed').addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 100) value = 100;
            if (value > 2000) value = 2000;
            this.settings.autoScroll.scrollSpeed = value;
            e.target.value = value;
            this.saveSettings();
        });
        
        document.getElementById('scrollInterval').addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 500) value = 500;
            if (value > 5000) value = 5000;
            this.settings.autoScroll.scrollInterval = value;
            e.target.value = value;
            this.saveSettings();
        });
        
        document.getElementById('smoothScroll').addEventListener('change', (e) => {
            this.settings.autoScroll.smoothScroll = e.target.checked;
            this.saveSettings();
        });
        
        document.getElementById('autoScrollToTop').addEventListener('change', (e) => {
            this.settings.autoScroll.autoScrollToTop = e.target.checked;
            this.saveSettings();
        });
        
        document.getElementById('scrollDuration').addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 3600) value = 3600;
            this.settings.autoScroll.scrollDuration = value;
            e.target.value = value;
            this.saveSettings();
        });
        
        // Filter preset handlers
        document.getElementById('savePresetBtn').addEventListener('click', () => {
            this.saveFilterPreset();
        });
        
        document.getElementById('deletePresetBtn').addEventListener('click', () => {
            this.deleteFilterPreset();
        });
        
        document.getElementById('presetSelector').addEventListener('change', (e) => {
            this.loadFilterPreset(e.target.value);
        });
        
        // Format buttons
        const formatButtons = document.querySelectorAll('.format-btn');
        formatButtons.forEach(button => {
            button.addEventListener('click', () => {
                document.getElementById('fileNamePattern').value = button.getAttribute('data-format');
                this.settings.fileNamePattern = button.getAttribute('data-format');
                this.saveSettings();
            });
        });
        
        // Keyword filter toggle
        document.getElementById('keywordToggle').addEventListener('click', () => {
            this.toggleKeywordFilter();
        });
        
        // Keyword preset buttons
        const keywordPresetButtons = document.querySelectorAll('.keyword-preset-btn');
        keywordPresetButtons.forEach(button => {
            button.addEventListener('click', () => {
                this.addKeywordToExclude(button.getAttribute('data-keyword'));
            });
        });
    }
    
    // Toggle keyword filter section
    toggleKeywordFilter() {
        const content = document.getElementById('keywordContent');
        const toggle = document.getElementById('keywordToggle');
        const icon = toggle.querySelector('.toggle-icon');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.style.transform = 'rotate(180deg)';
            toggle.classList.add('expanded');
        } else {
            content.style.display = 'none';
            icon.style.transform = 'rotate(0deg)';
            toggle.classList.remove('expanded');
        }
    }
    
    // Add keyword to exclude list
    addKeywordToExclude(keyword) {
        const excludeInput = document.getElementById('excludeKeywords');
        const currentKeywords = excludeInput.value.trim();
        
        if (currentKeywords) {
            const keywords = currentKeywords.split(',').map(k => k.trim());
            if (!keywords.includes(keyword)) {
                excludeInput.value = currentKeywords + ',' + keyword;
            }
        } else {
            excludeInput.value = keyword;
        }
        
        // Trigger change event to save settings
        excludeInput.dispatchEvent(new Event('change'));
        this.setStatus(`已添加屏蔽词: ${keyword}`);
    }

    // Save current filter as preset
    async saveFilterPreset() {
        const presetName = prompt('请输入预设名称:', '');
        if (!presetName) return;
        
        const newPreset = {
            name: presetName,
            filters: JSON.parse(JSON.stringify(this.settings.filters))
        };
        
        this.filterPresets.push(newPreset);
        await this.saveFilterPresets();
        this.setStatus('已保存过滤预设');
    }
    
    // Delete selected preset
    async deleteFilterPreset() {
        const selector = document.getElementById('presetSelector');
        const index = parseInt(selector.value);
        
        if (isNaN(index) || index < 0) return;
        
        if (confirm(`确定要删除预设 "${this.filterPresets[index].name}" 吗？`)) {
            this.filterPresets.splice(index, 1);
            await this.saveFilterPresets();
            this.setStatus('已删除过滤预设');
        }
    }
    
    // Load selected preset
    loadFilterPreset(indexStr) {
        const index = parseInt(indexStr);
        
        if (isNaN(index) || index < 0 || index >= this.filterPresets.length) return;
        
        const preset = this.filterPresets[index];
        this.settings.filters = JSON.parse(JSON.stringify(preset.filters));
        this.saveSettings();
        this.updateUI();
        this.setStatus(`已加载预设: ${preset.name}`);
    }

    // Setup message listener for runtime messages
    setupMessageListener() {
        // Listen for messages from content script or background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message);
            return true; // Keep the message channel open for async responses
        });
    }

    // Handle messages from background script
    handleMessage(message) {
        switch (message.type) {
            case 'progressUpdate':
                this.updateProgress(message.data);
                break;
            case 'downloadComplete':
                this.downloadComplete(message.data);
                break;
            case 'downloadError':
                this.showError(message.error);
                this.hideProgress();
                this.isDownloading = false;
                break;
            case 'scrollStatus':
                this.handleScrollStatus(message.data);
                break;
        }
    }

    // Open popup settings
    openPopupSettings() {
        const settingsContent = document.getElementById('settingsContent');
        if (settingsContent.style.display === 'none') {
            this.toggleSettings(true);
        }
    }

    // Check if we're on a supported page
    async checkCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (tab.url.includes('t.bilibili.com') || tab.url.includes('space.bilibili.com')) {
                this.setStatus('就绪');
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
    
    // Toggle filter section visibility
    toggleFilter(forceExpand = false) {
        const filterContent = document.getElementById('filterContent');
        const toggleIcon = document.querySelector('#filterToggle .toggle-icon');
        
        if (filterContent.style.display === 'none' || forceExpand) {
            filterContent.style.display = 'block';
            toggleIcon.textContent = '▲';
        } else {
            filterContent.style.display = 'none';
            toggleIcon.textContent = '▼';
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

    // Check current auto scroll status and sync UI
    async checkAutoScrollStatus() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (tab.url.includes('t.bilibili.com') || tab.url.includes('space.bilibili.com')) {
                // Check if auto scroll is currently running
                const response = await this.sendMessageWithTimeout(tab.id, {
                    type: 'getAutoScrollStatus'
                }, 3000);

                if (response && response.success && response.isScrolling) {
                    // Auto scroll is running, sync UI
                    document.getElementById('autoScrollSwitch').checked = true;
                    document.getElementById('downloadBtn').disabled = true;
                    
                    let statusText = '正在自动滚动...';
                    if (response.remainingTime !== null && response.remainingTime !== undefined) {
                        const minutes = Math.floor(response.remainingTime / 60);
                        const seconds = Math.floor(response.remainingTime % 60);
                        if (minutes > 0) {
                            statusText += ` (剩余 ${minutes}:${seconds.toString().padStart(2, '0')})`;
                        } else {
                            statusText += ` (剩余 ${seconds}秒)`;
                        }
                    }
                    this.setStatus(statusText);
                }
            }
        } catch (error) {
            console.error('Failed to check auto scroll status:', error);
            // Don't show error to user as this is just a status check
        }
    }

    // Start autoscroll
    async startAutoScroll() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tab.id, { 
                type: 'startAutoScroll', 
                settings: this.settings.autoScroll 
            });
            this.setStatus('自动滚动已开始...');
            document.getElementById('downloadBtn').disabled = true;
        } catch (error) {
            console.error('Failed to start autoscroll:', error);
            this.showError('无法开始自动滚动');
        }
    }

    // Stop autoscroll
    async stopAutoScroll() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tab.id, { type: 'stopAutoScroll' });
            this.setStatus('自动滚动已停止');
            document.getElementById('downloadBtn').disabled = false;
        } catch (error) {
            console.error('Failed to stop autoscroll:', error);
            this.showError('无法停止自动滚动');
        }
    }

    handleScrollStatus(data) {
        if (data.status === 'finished') {
            this.setStatus('自动滚动完成');
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('autoScrollSwitch').checked = false; // Turn off the switch
        } else if (data.status === 'duration_finished') {
            this.setStatus('自动滚动已达到设定时间');
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('autoScrollSwitch').checked = false; // Turn off the switch
        } else if (data.status === 'scrolling') {
            let statusText = '正在自动滚动...';
            if (data.remainingTime !== null && data.remainingTime !== undefined) {
                const minutes = Math.floor(data.remainingTime / 60);
                const seconds = Math.floor(data.remainingTime % 60);
                if (minutes > 0) {
                    statusText += ` (剩余 ${minutes}:${seconds.toString().padStart(2, '0')})`;
                } else {
                    statusText += ` (剩余 ${seconds}秒)`;
                }
            }
            this.setStatus(statusText);
        } else if (data.status === 'interrupted') {
            this.setStatus('自动滚动已中断');
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('autoScrollSwitch').checked = false; // Turn off the switch
        } else if (data.status === 'stopped') {
            this.setStatus('自动滚动已停止');
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('autoScrollSwitch').checked = false; // Turn off the switch
        }
    }
    
    // Toggle auto scroll settings visibility
    toggleAutoScrollSettings(forceExpand = false) {
        const settingsContent = document.getElementById('autoScrollSettingsContent');
        const toggleIcon = document.querySelector('#autoScrollSettingsToggle .toggle-icon');
        
        if (settingsContent.style.display === 'none' || forceExpand) {
            settingsContent.style.display = 'block';
            toggleIcon.textContent = '▲';
        } else {
            settingsContent.style.display = 'none';
            toggleIcon.textContent = '▼';
        }
    }
    
    // Open auto scroll settings
    openAutoScrollSettings() {
        // Open main settings first
        this.toggleSettings(true);
        // Then open auto scroll settings
        setTimeout(() => {
            this.toggleAutoScrollSettings(true);
            // Scroll to auto scroll settings
            const autoScrollSettings = document.getElementById('autoScrollSettingsContent');
            if (autoScrollSettings) {
                autoScrollSettings.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 100);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BilibiliDownloader();
}); 