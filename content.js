// Content script for extracting dynamic information from Bilibili pages
class BilibiliContentScript {
    constructor() {
        this.downloadedIds = new Set();
        this.downloadButton = null;
        this.isDownloading = false;
        this.currentUrl = window.location.href;
        this.observer = null;
        this.scrollAnimationId = null; // For autoscroll
        this.isScrolling = false;
        this.init();
    }

    async init() {
        try {

            if (!chrome.runtime || !chrome.runtime.id) {
                console.error('Extension context invalidated in init');

                setTimeout(() => this.init(), 5000);
                return;
            }

            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                this.handleMessage(message, sendResponse);
                return true;
            });

            await this.loadDownloadedIds();
            
            // Initial button setup
            this.setupDownloadButton();
            
            // Monitor page changes
            this.startPageMonitoring();
            
            console.log('Content script initialized successfully');
        } catch (error) {
            console.error('Failed to initialize content script:', error);

            if (error.message && error.message.includes('Extension context invalidated')) {
                console.log('Will retry initialization in 5 seconds');
                setTimeout(() => this.init(), 5000);
            }
        }
    }

    // Start monitoring page changes and DOM updates
    startPageMonitoring() {
        // Monitor URL changes (SPA navigation)
        this.startUrlMonitoring();
        
        // Monitor DOM changes
        this.startDomMonitoring();
    }

    // Monitor URL changes for SPA navigation
    startUrlMonitoring() {
        // Check URL changes periodically
        setInterval(() => {
            if (window.location.href !== this.currentUrl) {
                console.log('URL changed from', this.currentUrl, 'to', window.location.href);
                this.currentUrl = window.location.href;
                this.handlePageChange();
            }
        }, 1000);

        // Also listen for popstate events (back/forward navigation)
        window.addEventListener('popstate', () => {
            setTimeout(() => {
                this.handlePageChange();
            }, 500);
        });

        // Listen for pushstate/replacestate (programmatic navigation)
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(...args) {
            originalPushState.apply(history, args);
            setTimeout(() => {
                window.dispatchEvent(new Event('urlchange'));
            }, 100);
        };

        history.replaceState = function(...args) {
            originalReplaceState.apply(history, args);
            setTimeout(() => {
                window.dispatchEvent(new Event('urlchange'));
            }, 100);
        };

        window.addEventListener('urlchange', () => {
            this.handlePageChange();
        });
    }

    // Monitor DOM changes more comprehensively
    startDomMonitoring() {
        if (this.observer) {
            this.observer.disconnect();
        }

        this.observer = new MutationObserver((mutations) => {
            let shouldCheck = false;

            for (const mutation of mutations) {
                // Check if sidebar-related elements were added/removed
                if (mutation.type === 'childList') {
                    const addedNodes = Array.from(mutation.addedNodes);
                    const removedNodes = Array.from(mutation.removedNodes);
                    
                    // Check if sidebar or navigation elements were modified
                    const hasNavChanges = [...addedNodes, ...removedNodes].some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            return node.classList?.contains('side-nav') ||
                                   node.classList?.contains('space-dynamic__left') ||
                                   node.querySelector?.('.side-nav') ||
                                   node.classList?.contains('bili-download-item');
                        }
                        return false;
                    });

                    if (hasNavChanges) {
                        shouldCheck = true;
                        break;
                    }
                }
            }

            if (shouldCheck) {
                // Debounce to avoid excessive checks
                clearTimeout(this.checkTimeout);
                this.checkTimeout = setTimeout(() => {
                    this.setupDownloadButton();
                }, 500);
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }

    // Handle page change events
    handlePageChange() {
        console.log('Page changed, rechecking download button');
        
        // Reset button reference since page content might have changed
        this.downloadButton = null;
        
        // Wait a bit for the new page to load
        setTimeout(() => {
            this.setupDownloadButton();
        }, 1000);
    }

    // Setup download button (main entry point)
    setupDownloadButton() {
        if (this.isSupportedPage()) {
            this.addDownloadButton();
        } else {
            // Remove button if page no longer supports download
            this.removeDownloadButton();
        }
    }

    // Remove download button
    removeDownloadButton() {
        if (this.downloadButton && this.downloadButton.parentNode) {
            this.downloadButton.parentNode.removeChild(this.downloadButton);
            this.downloadButton = null;
            console.log('Download button removed (unsupported page)');
        }
    }

    // Check if current page supports download functionality
    isSupportedPage() {
        const url = window.location.href;
        return url.includes('t.bilibili.com') || 
               (url.includes('space.bilibili.com') && url.includes('dynamic'));
    }

    // Add download button to sidebar navigation
    addDownloadButton() {
        // Don't add if button already exists
        if (this.downloadButton && document.body.contains(this.downloadButton)) {
            return;
        }

        // Wait for sidebar to load with more persistent checking
        const maxAttempts = 20;
        let attempts = 0;

        const checkSidebar = () => {
            attempts++;
            const sideNav = document.querySelector('.side-nav');
            
            if (sideNav && !sideNav.querySelector('.bili-download-item')) {
                this.injectDownloadButton(sideNav);
            } else if (attempts < maxAttempts) {
                // Retry with exponential backoff
                const delay = Math.min(500 * Math.pow(1.2, attempts), 3000);
                setTimeout(checkSidebar, delay);
            }
        };

        checkSidebar();
    }

    // Inject download button into sidebar
    injectDownloadButton(sideNav) {
        // Double check we don't already have a button
        if (sideNav.querySelector('.bili-download-item')) {
            return;
        }

        // Create download button with Bilibili's native style
        const downloadItem = document.createElement('div');
        downloadItem.className = 'side-nav__item bili-download-item';
        downloadItem.innerHTML = `
            <div class="side-nav__item__main">
                <span class="side-nav__item__main-text">下载图片</span>
            </div>
            <div class="side-nav__item__sub">
                <span class="bili-download-settings" title="打开设置">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
                <span class="bili-download-status" title="就绪" data-status="ready">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </div>
        `;

        // Add custom styles to match Bilibili theme (only add once)
        if (!document.querySelector('#bili-download-styles')) {
            const style = document.createElement('style');
            style.id = 'bili-download-styles';
            style.textContent = `
                .bili-download-item {
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                
                .bili-download-item:hover {
                    background-color: rgba(0, 135, 189, 0.1);
                }
                
                .bili-download-item.downloading {
                    background-color: rgba(0, 135, 189, 0.1);
                }
                
                /* Prevent text wrapping for main text */
                .bili-download-item .side-nav__item__main-text {
                    color: #0087BD;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                
                /* Prevent icon wrapping in sub container */
                .bili-download-item .side-nav__item__sub {
                    display: flex;
                    align-items: center;
                    flex-wrap: nowrap;
                    gap: 4px;
                }
                
                .bili-download-status {
                    color: #999;
                    display: inline-flex;
                    align-items: center;
                    transition: all 0.2s ease;
                    flex-shrink: 0;
                }
                
                .bili-download-status svg {
                    transition: all 0.2s ease;
                }
                
                /* Status-specific colors and animations */
                .bili-download-status[data-status="loading"] {
                    color: #0087BD;
                }
                
                .bili-download-status[data-status="loading"] svg {
                    animation: spin 1s linear infinite;
                }
                
                .bili-download-status[data-status="success"] {
                    color: #52c41a;
                }
                
                .bili-download-status[data-status="error"] {
                    color: #ff4d4f;
                }
                
                .bili-download-status[data-status="warning"] {
                    color: #faad14;
                }
                
                .bili-download-status[data-status="stopped"] {
                    color: #8c8c8c;
                }
                
                .bili-download-status[data-status="ready"] {
                    color: #999;
                }
                
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                
                .bili-download-settings {
                    color: #0087BD;
                    margin-right: 8px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    transition: all 0.2s ease;
                    border-radius: 3px;
                    padding: 2px;
                    flex-shrink: 0;
                }
                
                .bili-download-settings:hover {
                    background-color: rgba(0, 135, 189, 0.1);
                    transform: scale(1.1);
                }
                
                .bili-download-settings svg {
                    transition: all 0.2s ease;
                }
                
                .bili-download-item.downloading .bili-download-status {
                    color: #0087BD;
                }
                
                /* Dark mode styles */
                @media (prefers-color-scheme: dark) {
                    .bili-download-item:hover {
                        background-color: rgba(0, 149, 210, 0.2);
                    }
                    
                    .bili-download-item.downloading {
                        background-color: rgba(0, 149, 210, 0.2);
                    }
                    
                    .bili-download-item .side-nav__item__main-text {
                        color: #0095d2;
                    }
                    
                    .bili-download-status {
                        color: #aaa;
                    }
                    
                    .bili-download-settings {
                        color: #0095d2;
                    }
                    
                    .bili-download-settings:hover {
                        background-color: rgba(0, 149, 210, 0.2);
                    }
                    
                    .bili-download-item.downloading .bili-download-status {
                        color: #0095d2;
                    }
                    
                    /* Dark mode status colors */
                    .bili-download-status[data-status="loading"] {
                        color: #0095d2;
                    }
                    
                    .bili-download-status[data-status="success"] {
                        color: #73d13d;
                    }
                    
                    .bili-download-status[data-status="error"] {
                        color: #ff7875;
                    }
                    
                    .bili-download-status[data-status="warning"] {
                        color: #ffc53d;
                    }
                    
                    .bili-download-status[data-status="stopped"] {
                        color: #bfbfbf;
                    }
                    
                    .bili-download-status[data-status="ready"] {
                        color: #aaa;
                    }
                }
            `;
            
            document.head.appendChild(style);
        }

        // Add click event handler for download button
        downloadItem.querySelector('.side-nav__item__main').addEventListener('click', () => {
            this.startDownloadFromSidebar();
        });

        // Add click event handler for settings button
        downloadItem.querySelector('.bili-download-settings').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering the main button click
            this.openSettings();
        });

        // Insert after the last nav item
        sideNav.appendChild(downloadItem);
        this.downloadButton = downloadItem;
        
        // Initialize with ready status
        this.updateDownloadStatus('就绪', false);

        console.log('Download button added to sidebar');
    }

    // Open settings popup
    openSettings() {
        try {

            if (chrome.runtime && chrome.runtime.id) {

                chrome.runtime.sendMessage({
                    type: 'openPopup'
                }).catch(error => {
                    console.error('Failed to open settings popup:', error);
                    this.showSettingsNotification('无法打开设置，请刷新页面后重试');
                });
                console.log('Opening popup settings');
            } else {

                console.error('Extension context invalidated');
                this.showSettingsNotification('扩展上下文已失效，请刷新页面');
                

                this.attemptRecovery();
            }
        } catch (error) {
            console.error('Error opening settings:', error);
            this.showSettingsNotification('打开设置时出错，请刷新页面后重试');
        }
    }
    

    attemptRecovery() {

        this.removeDownloadButton();
        

        setTimeout(() => {
            this.setupDownloadButton();
        }, 2000);
    }

    // Start download process from sidebar button
    async startDownloadFromSidebar() {
        if (this.isDownloading) return;

        try {
            // 检查扩展上下文是否有效
            if (!chrome.runtime || !chrome.runtime.id) {
                console.error('Extension context invalidated');
                this.showSettingsNotification('扩展上下文已失效，请刷新页面');
                this.attemptRecovery();
                return;
            }

            this.isDownloading = true;
            this.updateDownloadStatus('扫描中...', true);

            // Get current page dynamics
            const settings = await this.getDefaultSettings();
            const dynamics = await this.extractDynamics(settings);

            if (dynamics.length === 0) {
                this.updateDownloadStatus('未找到图片', false);
                setTimeout(() => {
                    this.updateDownloadStatus('就绪', false);
                }, 3000);
                return;
            }

            // 添加下载数量限制提示
            const maxDownloads = settings.maxDownloads || 0;
            let statusText = `找到 ${dynamics.length} 条动态`;
            
            // 如果应用了限制，且实际动态数量超过限制，显示提示
            if (maxDownloads > 0) {
                const totalFound = document.querySelectorAll('.bili-dyn-list .bili-dyn-item').length;
                if (totalFound > maxDownloads) {
                    statusText += ` (已限制，共${totalFound}条)`;
                }
            }
            
            this.updateDownloadStatus(statusText, true);

            // Send to background script for processing
            try {
                await chrome.runtime.sendMessage({
                    type: 'startDownload',
                    dynamics: dynamics,
                    settings: settings
                });
            } catch (error) {
                console.error('Failed to send message to background script:', error);
                throw new Error('与扩展通信失败，请刷新页面后重试');
            }

        } catch (error) {
            console.error('Download failed:', error);
            this.updateDownloadStatus('下载失败', false);
            

            if (error.message.includes('Extension context invalidated') || 
                error.message.includes('与扩展通信失败')) {
                this.showSettingsNotification(error.message);
            }
            
            setTimeout(() => {
                this.updateDownloadStatus('就绪', false);
            }, 3000);
        } finally {
            // Reset downloading state after a delay
            setTimeout(() => {
                this.isDownloading = false;
            }, 1000);
        }
    }

    // Update download button status with icons
    updateDownloadStatus(text, isDownloading = false) {
        if (!this.downloadButton || !document.body.contains(this.downloadButton)) return;

        const statusEl = this.downloadButton.querySelector('.bili-download-status');
        if (statusEl) {
            // Update tooltip
            statusEl.title = text;
            
            // Update icon based on status
            statusEl.innerHTML = this.getStatusIcon(text, isDownloading);
            statusEl.setAttribute('data-status', this.getStatusType(text, isDownloading));
        }

        if (isDownloading) {
            this.downloadButton.classList.add('downloading');
        } else {
            this.downloadButton.classList.remove('downloading');
        }
    }
    
    // Get appropriate icon for status
    getStatusIcon(text, isDownloading) {
        if (isDownloading || text.includes('扫描') || text.includes('下载中')) {
            // Loading/spinning icon
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        } else if (text.includes('完成') || text.includes('成功')) {
            // Success icon
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        } else if (text.includes('失败') || text.includes('错误')) {
            // Error icon
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2"/>
                <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2"/>
            </svg>`;
        } else if (text.includes('停止')) {
            // Stop icon
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="currentColor"/>
            </svg>`;
        } else if (text.includes('未找到')) {
            // Warning icon
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2"/>
                <circle cx="12" cy="17" r="1" fill="currentColor"/>
            </svg>`;
        } else {
            // Default ready icon
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }
    }
    
    // Get status type for CSS styling
    getStatusType(text, isDownloading) {
        if (isDownloading || text.includes('扫描') || text.includes('下载中')) {
            return 'loading';
        } else if (text.includes('完成') || text.includes('成功')) {
            return 'success';
        } else if (text.includes('失败') || text.includes('错误')) {
            return 'error';
        } else if (text.includes('停止')) {
            return 'stopped';
        } else if (text.includes('未找到')) {
            return 'warning';
        } else {
            return 'ready';
        }
    }

    // Get default settings for sidebar download
    async getDefaultSettings() {
        try {
            const result = await chrome.storage.local.get('bilibiliDownloaderSettings');
            const defaultSettings = {
                fileNamePattern: '{original}.{ext}',
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
                }
            };
            
            const settings = { ...defaultSettings, ...result.bilibiliDownloaderSettings };
            
            // Ensure filters object exists and has all required properties
            if (!settings.filters) {
                settings.filters = defaultSettings.filters;
            } else {
                // Merge with default filters to ensure all properties exist
                settings.filters = { ...defaultSettings.filters, ...settings.filters };
                
                // Ensure dynamicTypes exists
                if (!settings.filters.dynamicTypes) {
                    settings.filters.dynamicTypes = defaultSettings.filters.dynamicTypes;
                }
            }
            
            return settings;
        } catch (error) {
            console.error('Failed to load settings:', error);
            return {
                fileNamePattern: '{original}.{ext}',
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
                }
            };
        }
    }

    // Load downloaded dynamic IDs from storage
    async loadDownloadedIds() {
        try {

            if (!chrome.runtime || !chrome.runtime.id) {
                console.error('Extension context invalidated in loadDownloadedIds');
                return;
            }

            const result = await chrome.storage.local.get('downloadedDynamics');
            if (result.downloadedDynamics) {
                this.downloadedIds = new Set(result.downloadedDynamics);
            }
        } catch (error) {
            console.error('Failed to load download history:', error);

            if (error.message && error.message.includes('Extension context invalidated')) {
                this.attemptRecovery();
            }
        }
    }

    // Save downloaded dynamic ID to storage
    async saveDownloadedId(dynamicId) {
        try {

            if (!chrome.runtime || !chrome.runtime.id) {
                console.error('Extension context invalidated in saveDownloadedId');
                return;
            }

            this.downloadedIds.add(dynamicId);
            await chrome.storage.local.set({
                downloadedDynamics: Array.from(this.downloadedIds)
            });
        } catch (error) {
            console.error('Failed to save download history:', error);

            if (error.message && error.message.includes('Extension context invalidated')) {
                this.attemptRecovery();
            }
        }
    }

    // Handle messages from popup and background
    async handleMessage(message, sendResponse) {
        try {

            if (!chrome.runtime || !chrome.runtime.id) {
                console.error('Extension context invalidated in handleMessage');
                sendResponse({ success: false, error: 'Extension context invalidated' });
                return;
            }

            switch (message.type) {
                case 'ping':
                    sendResponse({ success: true, message: 'Content script ready' });
                    break;
                case 'getDynamics':
                    const dynamics = await this.extractDynamics(message.settings);
                    sendResponse({ success: true, dynamics });
                    break;
                case 'startAutoScroll':
                    this.startAutoScroll(message.settings);
                    sendResponse({ success: true });
                    break;
                case 'stopAutoScroll':
                    this.stopAutoScroll();
                    sendResponse({ success: true });
                    break;
                case 'getAutoScrollStatus':
                    const currentTime = performance.now();
                    const totalElapsedTime = this.scrollStartTime ? (currentTime - this.scrollStartTime) / 1000 : 0;
                    const remainingTime = this.autoScrollSettings && this.autoScrollSettings.scrollDuration > 0 
                        ? Math.max(0, this.autoScrollSettings.scrollDuration - totalElapsedTime)
                        : null;
                    
                    sendResponse({ 
                        success: true, 
                        isScrolling: this.isScrolling,
                        settings: this.autoScrollSettings || null,
                        remainingTime: remainingTime,
                        totalElapsedTime: totalElapsedTime
                    });
                    break;
                case 'markAsDownloaded':
                    await this.saveDownloadedId(message.dynamicId);
                    sendResponse({ success: true });
                    break;
                case 'downloadProgress':
                    // Update sidebar button status
                    if (message.data && message.data.current && message.data.total) {
                        this.updateDownloadStatus(
                            `下载中 ${message.data.current}/${message.data.total}`, 
                            true
                        );
                    }
                    sendResponse({ success: true });
                    break;
                case 'downloadComplete':
                    // Update sidebar button status
                    const data = message.data;
                    if (data.stopped) {
                        this.updateDownloadStatus('已停止', false);
                    } else {
                        this.updateDownloadStatus(`完成! ${data.success} 成功`, false);
                    }
                    setTimeout(() => {
                        this.updateDownloadStatus('就绪', false);
                    }, 5000);
                    sendResponse({ success: true });
                    break;
                case 'openSettingsFromSidebar':
                    // This is a fallback for browsers that don't support chrome.action.openPopup
                    // Show a notification to the user
                    this.showSettingsNotification();
                    sendResponse({ success: true });
                    break;
                default:
                    sendResponse({ success: false, error: 'Unknown message type' });
            }
        } catch (error) {
            console.error('Failed to handle message:', error);
            

            if (error.message && (
                error.message.includes('Extension context invalidated') || 
                !chrome.runtime || 
                !chrome.runtime.id
            )) {
                console.error('Extension context invalidated during message handling');
                this.attemptRecovery();
            }
            
            sendResponse({ success: false, error: error.message });
        }
    }

    // Show notification for browsers that don't support popup opening
    showSettingsNotification(message = '请点击浏览器工具栏中的插件图标打开设置') {
        // Create a notification element
        const notification = document.createElement('div');
        notification.className = 'bili-download-notification';
        notification.innerHTML = `
            <div class="bili-download-notification-content">
                <span>${message}</span>
                <button class="bili-download-notification-close">×</button>
            </div>
        `;

        // Add styles for the notification
        if (!document.querySelector('#bili-download-notification-styles')) {
            const style = document.createElement('style');
            style.id = 'bili-download-notification-styles';
            style.textContent = `
                .bili-download-notification {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 10000;
                    animation: bili-download-notification-fade 0.3s ease-in-out;
                }
                
                .bili-download-notification-content {
                    background-color: #0087BD;
                    color: white;
                    padding: 12px 16px;
                    border-radius: 4px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .bili-download-notification-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0;
                    margin: 0;
                }
                
                @keyframes bili-download-notification-fade {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                @media (prefers-color-scheme: dark) {
                    .bili-download-notification-content {
                        background-color: #0095d2;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // Add close button event
        notification.querySelector('.bili-download-notification-close').addEventListener('click', () => {
            document.body.removeChild(notification);
        });

        // Auto-remove after 5 seconds
        document.body.appendChild(notification);
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 5000);
    }

    // Extract dynamics from current page
    async extractDynamics(settings) {
        const dynamics = [];
        
        try {
            let dynamicCards = [];
            
            if (window.location.hostname === 't.bilibili.com') {
                dynamicCards = document.querySelectorAll('.bili-dyn-list .bili-dyn-item');
            } else if (window.location.hostname === 'space.bilibili.com') {
                dynamicCards = document.querySelectorAll('.bili-dyn-list .bili-dyn-item');
            }

            console.log(`Found ${dynamicCards.length} dynamic cards`);


            const maxDownloads = settings.maxDownloads || 0;
            let processedCount = 0;

            for (const card of dynamicCards) {
                try {

                    if (maxDownloads > 0 && dynamics.length >= maxDownloads) {
                        console.log(`Reached maximum download limit (${maxDownloads}), stopping extraction`);
                        break;
                    }

                    const dynamicInfo = await this.extractDynamicInfo(card, settings);
                    if (dynamicInfo) {
                        dynamics.push(dynamicInfo);
                    }
                } catch (error) {
                    console.error('Failed to extract dynamic info:', error);
                }
                
                
                processedCount++;
                if (processedCount % 10 === 0) {
                    console.log(`Processed ${processedCount}/${dynamicCards.length} dynamics, found ${dynamics.length} valid ones`);
                }
            }

            console.log(`Successfully extracted ${dynamics.length} valid dynamics${maxDownloads > 0 ? ` (max limit: ${maxDownloads})` : ''}`);
            return dynamics;

        } catch (error) {
            console.error('Failed to extract dynamics:', error);
            throw error;
        }
    }

    // Extract information from single dynamic card
    async extractDynamicInfo(card, settings) {
        try {
            const opusCard = card.querySelector('[dyn-id]');
            if (!opusCard) {
                return null;
            }

            const dynamicId = opusCard.getAttribute('dyn-id');
            if (!dynamicId) {
                return null;
            }

            // Check if already downloaded
            if (settings.skipDownloaded && this.downloadedIds.has(dynamicId)) {
                console.log(`Skipping downloaded dynamic: ${dynamicId}`);
                return null;
            }

            // Check if reposted dynamic
            if (settings.skipReference && card.querySelector('.reference')) {
                console.log(`Skipping reposted dynamic: ${dynamicId}`);
                return null;
            }

            // Check if contains images
            const hasImages = card.querySelector('.bili-album') || 
                             card.querySelector('.bili-dyn-gallery') ||
                             card.querySelector('.bili-album__preview__picture');

            if (!hasImages) {
                console.log(`Dynamic has no images, skipping: ${dynamicId}`);
                return null;
            }

            // Get user information
            const userNameEl = card.querySelector('.bili-dyn-item__author__name') ||
                              card.querySelector('.bili-dyn-author__name');
            const userName = userNameEl ? userNameEl.textContent.trim() : '';

            // Get dynamic content
            const contentEl = card.querySelector('.bili-rich-text__content') ||
                             card.querySelector('.bili-dyn-content__text');
            const content = contentEl ? contentEl.textContent.trim() : '';

            // Get publish time
            const timeEl = card.querySelector('.bili-dyn-time');
            const timeText = timeEl ? timeEl.textContent.trim() : '';

            // Apply keyword filters
            if (!this.passesKeywordFilter(content, settings.filters)) {
                console.log(`Dynamic filtered by keywords: ${dynamicId}`);
                return null;
            }

            return {
                dynamicId,
                userName,
                content: content.substring(0, 100),
                timeText,
                hasImages: true
            };

        } catch (error) {
            console.error('Failed to extract dynamic info:', error);
            return null;
        }
    }

    // Check if content passes keyword filters
    passesKeywordFilter(content, filters) {
        if (!filters) return true;
        
        const { includeKeywords, excludeKeywords, caseSensitive = false, exactMatch = false } = filters;
        
        // Debug logging for keyword filtering
        if ((includeKeywords && includeKeywords.trim()) || (excludeKeywords && excludeKeywords.trim())) {
            console.log('Keyword filter check:', {
                content: content.substring(0, 50) + '...',
                includeKeywords,
                excludeKeywords,
                caseSensitive,
                exactMatch
            });
        }
        
        // Prepare content for comparison
        let checkContent = caseSensitive ? content : content.toLowerCase();
        
        // Check exclude keywords (if content contains any exclude keyword, filter it out)
        if (excludeKeywords && excludeKeywords.trim()) {
            const excludeList = excludeKeywords.split(',').map(k => k.trim()).filter(k => k);
            for (const keyword of excludeList) {
                const checkKeyword = caseSensitive ? keyword : keyword.toLowerCase();
                
                if (exactMatch) {
                    // For exact match, use word boundaries
                    const regex = new RegExp(`\\b${this.escapeRegExp(checkKeyword)}\\b`, caseSensitive ? 'g' : 'gi');
                    if (regex.test(content)) {
                        console.log(`Content blocked by exclude keyword: "${keyword}"`);
                        return false;
                    }
                } else {
                    // For partial match
                    if (checkContent.includes(checkKeyword)) {
                        console.log(`Content blocked by exclude keyword: "${keyword}"`);
                        return false;
                    }
                }
            }
        }
        
        // Check include keywords (if specified, content must contain at least one)
        if (includeKeywords && includeKeywords.trim()) {
            const includeList = includeKeywords.split(',').map(k => k.trim()).filter(k => k);
            let hasIncludeKeyword = false;
            
            for (const keyword of includeList) {
                const checkKeyword = caseSensitive ? keyword : keyword.toLowerCase();
                
                if (exactMatch) {
                    // For exact match, use word boundaries
                    const regex = new RegExp(`\\b${this.escapeRegExp(checkKeyword)}\\b`, caseSensitive ? 'g' : 'gi');
                    if (regex.test(content)) {
                        hasIncludeKeyword = true;
                        break;
                    }
                } else {
                    // For partial match
                    if (checkContent.includes(checkKeyword)) {
                        hasIncludeKeyword = true;
                        break;
                    }
                }
            }
            
            if (!hasIncludeKeyword) {
                console.log(`Content filtered: does not contain required keywords`);
                return false;
            }
        }
        
        return true;
    }

    // Escape special regex characters
    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Wait for element to appear
    waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element timeout: ${selector}`));
            }, timeout);
        });
    }

    // Start autoscrolling the page
    startAutoScroll(settings = {}) {
        if (this.scrollAnimationId) {
            cancelAnimationFrame(this.scrollAnimationId);
        }

        // Use settings with defaults
        const scrollSpeed = settings.scrollSpeed || 1000;
        const scrollInterval = settings.scrollInterval || 1000;
        const smoothScroll = settings.smoothScroll !== false;
        const autoScrollToTop = settings.autoScrollToTop || false;
        const scrollDuration = settings.scrollDuration || 0; // 0 means unlimited

        // Store settings for later use
        this.autoScrollSettings = { scrollSpeed, scrollInterval, smoothScroll, autoScrollToTop, scrollDuration };

        // Initialize animation variables
        this.scrollStartTime = performance.now();
        this.lastScrollTime = this.scrollStartTime;
        this.lastScrollPosition = window.scrollY;
        this.targetScrollPosition = window.scrollY + scrollSpeed;
        this.isScrolling = true;
        
        // Initialize smart bottom detection variables
        this.lastPageHeight = null;
        this.pageHeightStableCount = 0;
        this.contentLoadingWaitCount = 0;

        // Easing function for smooth animation (easeOutCubic)
        this.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

        // Start the animation loop
        this.scrollAnimationStep();
    }

    // Animation step function using requestAnimationFrame
    scrollAnimationStep() {
        if (!this.isScrolling) return;

        const currentTime = performance.now();
        const timeSinceLastScroll = currentTime - this.lastScrollTime;
        const totalElapsedTime = (currentTime - this.scrollStartTime) / 1000; // Convert to seconds

        // Check if duration limit is reached
        if (this.autoScrollSettings.scrollDuration > 0 && totalElapsedTime >= this.autoScrollSettings.scrollDuration) {
            this.stopAutoScroll();
            
            // Scroll to top if requested
            if (this.autoScrollSettings.autoScrollToTop) {
                this.smoothScrollTo(0, 1000).then(() => {
                    chrome.runtime.sendMessage({ type: 'scrollStatus', data: { status: 'duration_finished' } });
                });
            } else {
                chrome.runtime.sendMessage({ type: 'scrollStatus', data: { status: 'duration_finished' } });
            }
            return;
        }

        // Check if enough time has passed for the next scroll step
        if (timeSinceLastScroll >= this.autoScrollSettings.scrollInterval) {
            // Smart bottom detection with loading awareness
            const bottomResult = this.smartBottomDetection();
            
            if (bottomResult.isBottom) {
                this.stopAutoScroll();
                
                // Scroll to top if requested
                if (this.autoScrollSettings.autoScrollToTop) {
                    this.smoothScrollTo(0, 1000).then(() => {
                        chrome.runtime.sendMessage({ type: 'scrollStatus', data: { status: 'finished' } });
                    });
                } else {
                    chrome.runtime.sendMessage({ type: 'scrollStatus', data: { status: 'finished' } });
                }
                return;
            }
            
            // If near bottom but content might be loading, wait a bit longer
            if (bottomResult.isNearBottom) {
                // Extend the interval to wait for content loading
                this.lastScrollTime = currentTime - (this.autoScrollSettings.scrollInterval * 0.7);
                
                // Continue to next animation frame
                this.scrollAnimationId = requestAnimationFrame(() => this.scrollAnimationStep());
                return;
            }

            // Check for scroll interruption (user manually scrolled)
            const currentScrollPosition = window.scrollY;
            if (Math.abs(currentScrollPosition - this.lastScrollPosition) > this.autoScrollSettings.scrollSpeed + 50) {
                // User has manually scrolled, stop auto scroll
                this.stopAutoScroll();
                chrome.runtime.sendMessage({ type: 'scrollStatus', data: { status: 'interrupted' } });
                return;
            }

            // Calculate next scroll position
            this.targetScrollPosition = currentScrollPosition + this.autoScrollSettings.scrollSpeed;
            this.lastScrollTime = currentTime;
            this.lastScrollPosition = currentScrollPosition;

            // Perform smooth scroll to target position
            if (this.autoScrollSettings.smoothScroll) {
                this.smoothScrollBy(this.autoScrollSettings.scrollSpeed, 800);
            } else {
                window.scrollBy(0, this.autoScrollSettings.scrollSpeed);
            }

            // Notify popup that we are scrolling with remaining time info
            const remainingTime = this.autoScrollSettings.scrollDuration > 0 
                ? Math.max(0, this.autoScrollSettings.scrollDuration - totalElapsedTime)
                : null;
            
            chrome.runtime.sendMessage({ 
                type: 'scrollStatus', 
                data: { 
                    status: 'scrolling',
                    remainingTime: remainingTime,
                    totalElapsedTime: totalElapsedTime
                } 
            });
        }

        // Continue animation
        this.scrollAnimationId = requestAnimationFrame(() => this.scrollAnimationStep());
    }

    // Smooth scroll by a certain amount
    smoothScrollBy(distance, duration = 600) {
        const startY = window.scrollY;
        const targetY = startY + distance;
        this.smoothScrollTo(targetY, duration);
    }

    // Smooth scroll to a specific position using requestAnimationFrame
    smoothScrollTo(targetY, duration = 600) {
        return new Promise((resolve) => {
            const startY = window.scrollY;
            const distance = targetY - startY;
            const startTime = performance.now();

            const animateScroll = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Apply easing function
                const easedProgress = this.easeOutCubic(progress);
                const currentY = startY + (distance * easedProgress);
                
                window.scrollTo(0, Math.round(currentY));

                if (progress < 1) {
                    requestAnimationFrame(animateScroll);
                } else {
                    resolve();
                }
            };

            requestAnimationFrame(animateScroll);
        });
    }

    // Smart bottom detection with content loading awareness
    smartBottomDetection() {
        const windowHeight = window.innerHeight;
        const scrollY = window.scrollY;
        const documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        
        const distanceFromBottom = documentHeight - (scrollY + windowHeight);
        const threshold = 100; // pixels from bottom
        const nearThreshold = 300; // pixels for "near bottom"
        
        // Initialize page height tracking if not exists
        if (!this.lastPageHeight) {
            this.lastPageHeight = documentHeight;
            this.pageHeightStableCount = 0;
            this.contentLoadingWaitCount = 0;
        }
        
        // Check if page height has changed (content is loading)
        const heightChanged = documentHeight > this.lastPageHeight;
        if (heightChanged) {
            this.lastPageHeight = documentHeight;
            this.pageHeightStableCount = 0;
            this.contentLoadingWaitCount = 0;
        } else {
            this.pageHeightStableCount++;
        }
        
        // Check for Bilibili loading indicators
        const hasLoadingIndicator = this.checkBilibiliLoadingState();
        
        // Near bottom detection
        const isNearBottom = distanceFromBottom <= nearThreshold;
        const isAtBottom = distanceFromBottom <= threshold;
        
        if (isAtBottom) {
            // If we're at bottom but height is still changing or loading indicators are present
            if (heightChanged || hasLoadingIndicator) {
                console.log('At bottom but content is still loading, waiting...');
                this.contentLoadingWaitCount++;
                
                // Wait up to configured times for new content
                const maxWaitTimes = Math.max(1, Math.floor((this.autoScrollSettings.contentLoadWait || 3) * 1000 / this.autoScrollSettings.scrollInterval));
                if (this.contentLoadingWaitCount < maxWaitTimes) {
                    return { isBottom: false, isNearBottom: true };
                }
            }
            
            // If page height has been stable for several checks, we're truly at bottom
            if (this.pageHeightStableCount >= 3) {
                console.log('Reached actual bottom of page');
                return { isBottom: true, isNearBottom: false };
            }
            
            // Still uncertain, wait a bit more
            return { isBottom: false, isNearBottom: true };
        }
        
        if (isNearBottom) {
            // Near bottom, give content time to load
            return { isBottom: false, isNearBottom: true };
        }
        
        // Not near bottom, continue scrolling normally
        return { isBottom: false, isNearBottom: false };
    }
    
    // Check for Bilibili specific loading indicators
    checkBilibiliLoadingState() {
        // Check for common loading indicators on Bilibili
        const loadingSelectors = [
            '.loading', 
            '.bili-loading',
            '.skeleton-loading',
            '.bili-dyn-list__skeleton',
            '[class*="loading"]',
            '[class*="skeleton"]'
        ];
        
        for (const selector of loadingSelectors) {
            const loadingElement = document.querySelector(selector);
            if (loadingElement && loadingElement.offsetParent !== null) {
                console.log(`Found loading indicator: ${selector}`);
                return true;
            }
        }
        
        // Check for network requests (simplified check)
        // This is a heuristic - if many images are still loading, content might still be coming
        const images = document.querySelectorAll('img[src*="bilibili"]');
        let loadingImages = 0;
        images.forEach(img => {
            if (!img.complete || img.naturalHeight === 0) {
                loadingImages++;
            }
        });
        
        if (loadingImages > 5) {
            console.log(`Found ${loadingImages} images still loading`);
            return true;
        }
        
        return false;
    }

    // Stop autoscrolling the page
    stopAutoScroll() {
        this.isScrolling = false;
        
        // Clean up page height tracking
        delete this.lastPageHeight;
        delete this.pageHeightStableCount;
        delete this.contentLoadingWaitCount;
        
        if (this.scrollAnimationId) {
            cancelAnimationFrame(this.scrollAnimationId);
            this.scrollAnimationId = null;
        }

        // Notify popup that scrolling has stopped
        try {
            chrome.runtime.sendMessage({ 
                type: 'scrollStatus', 
                data: { status: 'stopped' } 
            });
        } catch (error) {
            // Ignore errors if popup is not open
        }
    }

    // Scroll page to load more content
    async scrollToLoadMore(maxScrolls = 5) {
        let scrollCount = 0;
        const initialHeight = document.body.scrollHeight;

        while (scrollCount < maxScrolls) {
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (document.body.scrollHeight === initialHeight) {
                break;
            }
            
            scrollCount++;
        }

        window.scrollTo(0, 0);
    }
}

new BilibiliContentScript(); 