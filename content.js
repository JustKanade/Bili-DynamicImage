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
                                   node.classList?.contains('side-toolbar') ||
                                   node.querySelector?.('.side-nav') ||
                                   node.querySelector?.('.side-toolbar') ||
                                   node.classList?.contains('bili-download-item');
                        }
                        return false;
                    });
                    
                    // Check if dropdown menus were added (for injecting download option)
                    const hasMenuChanges = [...addedNodes].some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            return node.classList?.contains('bili-cascader-options') ||
                                   node.querySelector?.('.bili-cascader-options') ||
                                   node.classList?.contains('bili-dropdown-options') ||
                                   node.querySelector?.('.bili-dropdown-options');
                        }
                        return false;
                    });

                    if (hasNavChanges) {
                        shouldCheck = true;
                        break;
                    }
                    
                    if (hasMenuChanges) {
                        // Handle menu injection separately with shorter delay
                        clearTimeout(this.menuTimeout);
                        this.menuTimeout = setTimeout(() => {
                            this.injectDownloadMenuItem();
                        }, 100);
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
            this.addSideToolbarButton();
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
               (url.includes('space.bilibili.com') && url.includes('dynamic')) ||
               url.includes('www.bilibili.com/opus/');
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

    // Add download button to side toolbar (for dynamic detail pages)
    addSideToolbarButton() {
        // Don't add if button already exists
        if (this.sideToolbarButton && document.body.contains(this.sideToolbarButton)) {
            return;
        }

        // Wait for side toolbar to load
        const maxAttempts = 20;
        let attempts = 0;

        const checkSideToolbar = () => {
            attempts++;
            const sideToolbar = document.querySelector('.side-toolbar__box');
            
            if (sideToolbar && !sideToolbar.querySelector('.bili-download-toolbar-item')) {
                this.injectSideToolbarButton(sideToolbar);
            } else if (attempts < maxAttempts) {
                // Retry with exponential backoff
                const delay = Math.min(500 * Math.pow(1.2, attempts), 3000);
                setTimeout(checkSideToolbar, delay);
            }
        };

        checkSideToolbar();
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
                    transition: all 0.3s ease;
                }
                
                .bili-download-item:hover {
                    background-color: rgba(0, 135, 189, 0.1);
                }
                
                .bili-download-item.downloading {
                    background-color: rgba(0, 135, 189, 0.25);
                    border-left: 3px solid #0087BD;
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
                        background-color: rgba(0, 149, 210, 0.35);
                        border-left: 3px solid #0095d2;
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
            if (this.isDownloading) {
                this.stopDownloadFromSidebar();
            } else {
                this.startDownloadFromSidebar();
            }
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

    // Inject download button into side toolbar
    injectSideToolbarButton(sideToolbar) {
        // Double check we don't already have a button
        if (sideToolbar.querySelector('.bili-download-toolbar-item')) {
            return;
        }

        // Create download button with side toolbar styling
        const downloadAction = document.createElement('div');
        downloadAction.className = 'side-toolbar__action bili-download-toolbar-item';
        downloadAction.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C12.4142 2 12.75 2.33579 12.75 2.75V13.4393L16.2197 9.96967C16.5126 9.67678 16.9874 9.67678 17.2803 9.96967C17.5732 10.2626 17.5732 10.7374 17.2803 11.0303L12.5303 15.7803C12.2374 16.0732 11.7626 16.0732 11.4697 15.7803L6.71967 11.0303C6.42678 10.7374 6.42678 10.2626 6.71967 9.96967C7.01256 9.67678 7.48744 9.67678 7.78033 9.96967L11.25 13.4393V2.75C11.25 2.33579 11.5858 2 12 2ZM5 16.25C5.41421 16.25 5.75 16.5858 5.75 17V19C5.75 19.1381 5.86193 19.25 6 19.25H18C18.1381 19.25 18.25 19.1381 18.25 19V17C18.25 16.5858 18.5858 16.25 19 16.25C19.4142 16.25 19.75 16.5858 19.75 17V19C19.75 19.9665 18.9665 20.75 18 20.75H6C5.0335 20.75 4.25 19.9665 4.25 19V17C4.25 16.5858 4.5858 16.25 5 16.25Z" fill="currentColor"/>
            </svg>
            <div class="side-toolbar__action__text bili-download-count">0</div>
        `;

        // Add styles for the toolbar button
        if (!document.querySelector('#bili-side-toolbar-styles')) {
            const style = document.createElement('style');
            style.id = 'bili-side-toolbar-styles';
            style.textContent = `
                .bili-download-toolbar-item {
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .bili-download-toolbar-item:hover {
                    color: #00AEEC;
                }
                .bili-download-toolbar-item.downloading {
                    color: #FB7299;
                }
                .bili-download-toolbar-item.downloading svg {
                    animation: bili-download-spin 1s linear infinite;
                }
                @keyframes bili-download-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        // Add click event handler
        downloadAction.addEventListener('click', () => {
            this.handleSideToolbarDownloadClick();
        });

        // Insert the download button after the last action (usually comment)
        sideToolbar.appendChild(downloadAction);
        this.sideToolbarButton = downloadAction;
        
        // Update the count display
        this.updateSideToolbarCount();

        console.log('Download button added to side toolbar');
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

    // Handle download click from side toolbar
    async handleSideToolbarDownloadClick() {
        try {
            console.log('Side toolbar download clicked');
            
            // Debug: Check what images we can extract directly
            const directImages = this.extractImagesFromCard(document.body);
            console.log(`Direct image extraction found: ${directImages.length} images`);
            
            // For detail pages, treat as single dynamic download
            const dynamicInfo = await this.extractDetailPageDynamicInfo({ skipDownloaded: false, skipReference: false });
            if (!dynamicInfo) {
                console.log('No dynamic info found, but trying direct image extraction...');
                
                // If detail page extraction failed but we have images, try to create minimal dynamic info
                if (directImages.length > 0) {
                    console.log('Creating fallback dynamic info for direct images');
                    const fallbackDynamicInfo = {
                        dynamicId: 'current-page',
                        userName: 'Unknown',
                        content: 'Current Page Images',
                        timeText: '',
                        hasImages: true,
                        originalElement: document.body
                    };
                    this.showImageSelector(fallbackDynamicInfo, document.body);
                    return;
                }
                
                this.showNotification('该动态没有可下载的图片', 'warning');
                return;
            }

            // Show image selector for the current dynamic
            this.showImageSelector(dynamicInfo, document.body);
        } catch (error) {
            console.error('Failed to handle side toolbar download click:', error);
            this.showNotification('下载失败: ' + error.message, 'error');
        }
    }

    // Update side toolbar download count
    updateSideToolbarCount() {
        if (!this.sideToolbarButton) return;
        
        const countElement = this.sideToolbarButton.querySelector('.bili-download-count');
        if (countElement) {
            // Count images on current page
            const images = this.extractImagesFromCard(document.body);
            console.log(`Side toolbar count update: found ${images.length} images`);
            if (images.length > 0) {
                console.log('Image sources:', images.map(img => img.url));
            }
            countElement.textContent = images.length.toString();
        }
    }
    

    attemptRecovery() {

        this.removeDownloadButton();
        

        setTimeout(() => {
            this.setupDownloadButton();
        }, 2000);
    }

    // Inject download option into dynamic menu
    injectDownloadMenuItem() {
        try {
            // Find all visible dropdown menus
            const menus = document.querySelectorAll('.bili-cascader-options, .bili-dropdown-options');
            
            for (const menu of menus) {
                // Check if this menu contains a "举报" option and doesn't already have our download option
                const reportItem = menu.querySelector('.bili-cascader-options__item-label');
                if (reportItem && reportItem.textContent.includes('举报') && !menu.querySelector('.bili-download-menu-item')) {
                    this.addDownloadMenuOption(menu, reportItem);
                }
            }
        } catch (error) {
            console.error('Failed to inject download menu item:', error);
        }
    }

    // Add download option to dynamic menu
    addDownloadMenuOption(menu, reportItem) {
        try {
            // Create download menu item with native styling
            const downloadItem = document.createElement('div');
            downloadItem.className = 'bili-cascader-options__item bili-download-menu-item';
            downloadItem.innerHTML = `
                <div class="bili-cascader-options__item-label">下载图片</div>
            `;

            // Add click handler
            downloadItem.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleMenuDownloadClick(downloadItem);
            });

            // Insert after the report item
            const reportContainer = reportItem.closest('.bili-cascader-options__item');
            if (reportContainer && reportContainer.parentNode) {
                reportContainer.parentNode.insertBefore(downloadItem, reportContainer.nextSibling);
                console.log('Download menu item added');
            }
        } catch (error) {
            console.error('Failed to add download menu option:', error);
        }
    }

    // Handle download click from menu
    async handleMenuDownloadClick(menuItem) {
        try {
            // Find the dynamic card that contains this menu
            const dynamicCard = this.findDynamicCardFromMenu(menuItem);
            if (!dynamicCard) {
                this.showNotification('无法找到对应的动态卡片', 'error');
                return;
            }

            // Extract dynamic information
            const dynamicInfo = await this.extractDynamicInfo(dynamicCard, { skipDownloaded: false, skipReference: false });
            if (!dynamicInfo) {
                this.showNotification('该动态没有可下载的图片', 'warning');
                return;
            }

            // Show image selector
            this.showImageSelector(dynamicInfo, dynamicCard);
            
            // Don't close menu - let user close it naturally
        } catch (error) {
            console.error('Failed to handle menu download click:', error);
            this.showNotification('下载失败: ' + error.message, 'error');
        }
    }

    // Find dynamic card from menu element
    findDynamicCardFromMenu(menuElement) {
        let current = menuElement;
        while (current && current !== document.body) {
            current = current.parentElement;
            if (current && (current.classList.contains('bili-dyn-item') || current.classList.contains('bili-opus-view'))) {
                return current;
            }
        }
        
        // If not found in parent hierarchy, try to find by proximity
        const allCards = document.querySelectorAll('.bili-dyn-item, .bili-opus-view');
        for (const card of allCards) {
            const rect = card.getBoundingClientRect();
            const menuRect = menuElement.getBoundingClientRect();
            
            // Check if menu is near this card
            if (Math.abs(rect.right - menuRect.left) < 100 && 
                Math.abs(rect.top - menuRect.top) < 100) {
                return card;
            }
        }
        
        return null;
    }

    // Show image selector modal
    showImageSelector(dynamicInfo, dynamicCard) {
        try {
            // Remove existing selector if any
            const existingSelector = document.querySelector('.bili-image-selector');
            if (existingSelector) {
                existingSelector.remove();
            }

            // Get images from dynamic card
            const images = this.extractImagesFromCard(dynamicCard);
            if (images.length === 0) {
                this.showNotification('该动态没有可下载的图片', 'warning');
                return;
            }

            // Create selector modal
            const modal = this.createImageSelectorModal(images, dynamicInfo);
            document.body.appendChild(modal);
            
            // Show modal with animation
            requestAnimationFrame(() => {
                modal.classList.add('visible');
            });
        } catch (error) {
            console.error('Failed to show image selector:', error);
            this.showNotification('显示图片选择器失败', 'error');
        }
    }

    // Extract images from dynamic card or detail page
    extractImagesFromCard(card) {
        const images = [];
        
        try {
            let imageElements = [];
            let pictureElements = [];
            
            // Check if we're on a detail page (card is document.body)
            if (card === document.body) {
                // Detail page specific selectors
                imageElements = card.querySelectorAll('.opus-module-album img, .opus-album img, .bili-album__preview__picture img, .bili-dyn-gallery img, .bili-album img, .horizontal-scroll-album__pic__img img, .horizontal-scroll-album__indicator__thumbnail img, img[src*="i0.hdslb.com"]');
                pictureElements = card.querySelectorAll('.opus-module-album picture, .opus-album picture, .bili-album picture, .bili-dyn-gallery picture');
            } else {
                // Regular dynamic card selectors (support both old and new dynamic formats)
                imageElements = card.querySelectorAll('.bili-album__preview__picture img, .bili-dyn-gallery img, .bili-album img, .opus-module-content .bili-album img, .horizontal-scroll-album__pic__img img, .horizontal-scroll-album__indicator__thumbnail img');
                pictureElements = card.querySelectorAll('.bili-album picture, .bili-dyn-gallery picture, .opus-module-content .bili-album picture');
            }
            
            // Collect all potential images first
            const allImages = [];
            
            // Process picture elements first (higher quality)
            pictureElements.forEach((picture, index) => {
                const imageData = this.extractImageFromPicture(picture);
                if (imageData && this.isContentImage(imageData.url)) {
                    allImages.push({
                        url: imageData.url,
                        originalUrl: this.getOriginalImageUrl(imageData.url),
                        element: picture,
                        format: imageData.format,
                        priority: 1 // Highest priority for picture elements
                    });
                }
            });
            
            // Process remaining img elements that are not inside picture tags
            imageElements.forEach((img, index) => {
                // Skip if this img is inside a picture element we already processed
                if (img.closest('picture')) {
                    return;
                }
                
                const src = img.src || img.dataset.src || img.getAttribute('data-src');
                // Filter out non-content images (avatars, icons, etc.)
                if (src && !src.includes('loading') && this.isContentImage(src)) {
                    // Determine priority based on element class and image size
                    let priority = 2; // Default priority for img elements
                    
                    // Lower priority for thumbnail images
                    if (img.closest('.horizontal-scroll-album__indicator__thumbnail')) {
                        priority = 3;
                    }
                    
                    allImages.push({
                        url: src,
                        originalUrl: this.getOriginalImageUrl(src),
                        element: img,
                        format: 'img',
                        priority: priority
                    });
                }
            });
            
            // Process background images from horizontal scroll album
            const backgroundElements = card.querySelectorAll('.horizontal-scroll-album__pic__blurbg__inner');
            backgroundElements.forEach((bgElement, index) => {
                const imageData = this.extractImageFromBackground(bgElement);
                if (imageData && this.isContentImage(imageData.url)) {
                    allImages.push({
                        url: imageData.url,
                        originalUrl: this.getOriginalImageUrl(imageData.url),
                        element: bgElement,
                        format: imageData.format,
                        priority: 4 // Lower priority for background images
                    });
                }
            });
            
            // Remove duplicates based on originalUrl, keeping the highest priority version
            const uniqueImages = new Map();
            allImages.forEach(imageData => {
                const originalUrl = imageData.originalUrl;
                if (!uniqueImages.has(originalUrl) || uniqueImages.get(originalUrl).priority > imageData.priority) {
                    uniqueImages.set(originalUrl, imageData);
                }
            });
            
            // Convert to final images array
            Array.from(uniqueImages.values()).forEach((imageData, index) => {
                images.push({
                    index: index,
                    url: imageData.url,
                    originalUrl: imageData.originalUrl,
                    element: imageData.element,
                    format: imageData.format
                });
            });
        } catch (error) {
            console.error('Failed to extract images from card:', error);
        }
        
        return images;
    }

    // Extract image URL from CSS background-image style
    extractImageFromBackground(element) {
        try {
            const style = window.getComputedStyle(element);
            const backgroundImage = style.backgroundImage;
            
            if (backgroundImage && backgroundImage !== 'none') {
                // Extract URL from url("...") format
                const urlMatch = backgroundImage.match(/url\(["']?([^"']+)["']?\)/);
                if (urlMatch && urlMatch[1]) {
                    let url = urlMatch[1];
                    // Add protocol if missing
                    if (url.startsWith('//')) {
                        url = 'https:' + url;
                    }
                    return {
                        url: url,
                        format: 'background'
                    };
                }
            }
            
            return null;
        } catch (error) {
            console.error('Failed to extract image from background:', error);
            return null;
        }
    }

    // Extract image from picture element, prioritizing higher quality formats
    extractImageFromPicture(picture) {
        try {
            const sources = picture.querySelectorAll('source');
            const img = picture.querySelector('img');
            
            // Priority order: AVIF > WebP > others
            const formatPriority = ['avif', 'webp'];
            
            for (const format of formatPriority) {
                for (const source of sources) {
                    if (source.type && source.type.includes(format)) {
                        const srcset = source.getAttribute('srcset');
                        if (srcset) {
                            // Extract the first URL from srcset (usually the highest quality)
                            const url = srcset.split(',')[0].split(' ')[0];
                            if (url) {
                                return {
                                    url: url.startsWith('//') ? 'https:' + url : url,
                                    format: format
                                };
                            }
                        }
                    }
                }
            }
            
            // Fallback to other source elements
            for (const source of sources) {
                const srcset = source.getAttribute('srcset');
                if (srcset) {
                    const url = srcset.split(',')[0].split(' ')[0];
                    if (url) {
                        return {
                            url: url.startsWith('//') ? 'https:' + url : url,
                            format: 'unknown'
                        };
                    }
                }
            }
            
            // Final fallback to img element
            if (img) {
                const src = img.src || img.dataset.src || img.getAttribute('data-src');
                if (src) {
                    return {
                        url: src,
                        format: 'img'
                    };
                }
            }
            
            return null;
        } catch (error) {
            console.error('Failed to extract image from picture:', error);
            return null;
        }
    }

    // Check if image is a content image (not avatar, icon, etc.)
    isContentImage(src) {
        // Filter out avatars, icons, and other UI elements
        if (src.includes('face') || src.includes('avatar') || src.includes('icon') || 
            src.includes('logo') || src.includes('emoji') || src.includes('default')) {
            return false;
        }
        
        // Check if it's from bilibili's image CDN (including new_dyn path)
        return (src.includes('i0.hdslb.com') || src.includes('i1.hdslb.com') || 
                src.includes('i2.hdslb.com') || src.includes('biliimg.com')) &&
               (src.includes('bfs/album') || src.includes('bfs/new_dyn'));
    }

    // Get original image URL from thumbnail
    getOriginalImageUrl(thumbUrl) {
        // Remove thumbnail parameters to get original image
        return thumbUrl.replace(/@.*$/, '').replace(/\?.*$/, '');
    }

    // Create image selector modal
    createImageSelectorModal(images, dynamicInfo) {
        const modal = document.createElement('div');
        modal.className = 'bili-image-selector';
        modal.innerHTML = `
            <div class="bili-image-selector__overlay"></div>
            <div class="bili-image-selector__content">
                <div class="bili-image-selector__header">
                    <h3>选择要下载的图片</h3>
                    <button class="bili-image-selector__close">×</button>
                </div>
                <div class="bili-image-selector__controls">
                    <button class="bili-image-selector__select-all">全选</button>
                    <button class="bili-image-selector__select-none">取消全选</button>
                    <span class="bili-image-selector__counter">已选择: 0/${images.length}</span>
                </div>
                <div class="bili-image-selector__grid">
                    ${images.map((img, index) => `
                        <div class="bili-image-selector__item" data-index="${index}">
                            <img src="${img.url}" alt="图片 ${index + 1}" loading="lazy">
                            <div class="bili-image-selector__checkbox">
                                <input type="checkbox" id="img-${index}" value="${index}">
                                <label for="img-${index}"></label>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="bili-image-selector__footer">
                    <button class="bili-image-selector__cancel">取消</button>
                    <button class="bili-image-selector__download">下载选中图片</button>
                </div>
            </div>
        `;

        // Add event listeners
        this.setupImageSelectorEvents(modal, images, dynamicInfo);
        
        // Add styles
        this.addImageSelectorStyles();
        
        return modal;
    }

    // Setup image selector event listeners
    setupImageSelectorEvents(modal, images, dynamicInfo) {
        const overlay = modal.querySelector('.bili-image-selector__overlay');
        const closeBtn = modal.querySelector('.bili-image-selector__close');
        const cancelBtn = modal.querySelector('.bili-image-selector__cancel');
        const selectAllBtn = modal.querySelector('.bili-image-selector__select-all');
        const selectNoneBtn = modal.querySelector('.bili-image-selector__select-none');
        const downloadBtn = modal.querySelector('.bili-image-selector__download');
        const counter = modal.querySelector('.bili-image-selector__counter');
        const checkboxes = modal.querySelectorAll('input[type="checkbox"]');

        // Close modal handlers
        const closeModal = () => {
            modal.classList.remove('visible');
            setTimeout(() => modal.remove(), 300);
        };

        overlay.addEventListener('click', closeModal);
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);

        // Selection handlers
        const updateCounter = () => {
            const selected = modal.querySelectorAll('input[type="checkbox"]:checked').length;
            counter.textContent = `已选择: ${selected}/${images.length}`;
            downloadBtn.disabled = selected === 0;
        };

        selectAllBtn.addEventListener('click', () => {
            checkboxes.forEach(cb => cb.checked = true);
            updateCounter();
        });

        selectNoneBtn.addEventListener('click', () => {
            checkboxes.forEach(cb => cb.checked = false);
            updateCounter();
        });

        checkboxes.forEach(cb => {
            cb.addEventListener('change', updateCounter);
        });

        // Download handler
        downloadBtn.addEventListener('click', () => {
            const selectedIndexes = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.value));
            
            if (selectedIndexes.length === 0) {
                this.showNotification('请至少选择一张图片', 'warning');
                return;
            }

            const selectedImages = selectedIndexes.map(index => images[index]);
            this.downloadSelectedImages(selectedImages, dynamicInfo);
            closeModal();
        });

        // Initial counter update
        updateCounter();
    }

    // Download selected images
    async downloadSelectedImages(selectedImages, dynamicInfo) {
        try {
            this.showNotification(`开始下载 ${selectedImages.length} 张图片...`, 'info');

            // Send to background script for download
            chrome.runtime.sendMessage({
                type: 'downloadSelectedImages',
                images: selectedImages.map(img => ({
                    url: img.originalUrl,
                    index: img.index
                })),
                dynamicInfo: dynamicInfo
            });

        } catch (error) {
            console.error('Failed to download selected images:', error);
            this.showNotification('下载失败: ' + error.message, 'error');
        }
    }

    // Add image selector styles
    addImageSelectorStyles() {
        if (document.querySelector('#bili-image-selector-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'bili-image-selector-styles';
        style.textContent = `
            .bili-image-selector {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                z-index: 10000;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }

            .bili-image-selector.visible {
                opacity: 1;
                visibility: visible;
            }

            .bili-image-selector__overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
            }

            .bili-image-selector__content {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border-radius: 8px;
                max-width: 90vw;
                max-height: 90vh;
                overflow: hidden;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            }

            .bili-image-selector__header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid #e1e2e3;
                background: #f7f8fa;
            }

            .bili-image-selector__header h3 {
                margin: 0;
                font-size: 16px;
                color: #333;
            }

            .bili-image-selector__close {
                background: none;
                border: none;
                font-size: 24px;
                color: #999;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .bili-image-selector__close:hover {
                color: #666;
            }

            .bili-image-selector__controls {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 20px;
                border-bottom: 1px solid #e1e2e3;
                background: #fafbfc;
            }

            .bili-image-selector__controls button {
                padding: 6px 12px;
                border: 1px solid #0087BD;
                background: white;
                color: #0087BD;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s ease;
            }

            .bili-image-selector__controls button:hover {
                background: #0087BD;
                color: white;
            }

            .bili-image-selector__counter {
                margin-left: auto;
                font-size: 14px;
                color: #666;
            }

            .bili-image-selector__grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 12px;
                padding: 20px;
                max-height: 400px;
                overflow-y: auto;
            }

            .bili-image-selector__item {
                position: relative;
                aspect-ratio: 1;
                border-radius: 6px;
                overflow: hidden;
                border: 2px solid transparent;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .bili-image-selector__item:hover {
                border-color: #0087BD;
            }

            .bili-image-selector__item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .bili-image-selector__checkbox {
                position: absolute;
                top: 8px;
                right: 8px;
            }

            .bili-image-selector__checkbox input[type="checkbox"] {
                display: none;
            }

            .bili-image-selector__checkbox label {
                display: block;
                width: 20px;
                height: 20px;
                border: 2px solid white;
                border-radius: 4px;
                background: rgba(0, 0, 0, 0.5);
                cursor: pointer;
                position: relative;
                transition: all 0.2s ease;
            }

            .bili-image-selector__checkbox input[type="checkbox"]:checked + label {
                background: #0087BD;
                border-color: #0087BD;
            }

            .bili-image-selector__checkbox input[type="checkbox"]:checked + label::after {
                content: '✓';
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                color: white;
                font-size: 12px;
                font-weight: bold;
            }

            .bili-image-selector__footer {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 16px 20px;
                border-top: 1px solid #e1e2e3;
                background: #f7f8fa;
            }

            .bili-image-selector__footer button {
                padding: 8px 16px;
                border: 1px solid #ccc;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s ease;
            }

            .bili-image-selector__cancel {
                background: white;
                color: #666;
            }

            .bili-image-selector__cancel:hover {
                background: #f5f5f5;
            }

            .bili-image-selector__download {
                background: #0087BD;
                color: white;
                border-color: #0087BD;
            }

            .bili-image-selector__download:hover:not(:disabled) {
                background: #0078a8;
            }

            .bili-image-selector__download:disabled {
                background: #ccc;
                border-color: #ccc;
                cursor: not-allowed;
            }

            /* Dark mode support */
            @media (prefers-color-scheme: dark) {
                .bili-image-selector__content {
                    background: #1a1a1a;
                    color: #e0e0e0;
                }

                .bili-image-selector__header,
                .bili-image-selector__controls,
                .bili-image-selector__footer {
                    background: #2a2a2a;
                    border-color: #3a3a3a;
                }

                .bili-image-selector__header h3 {
                    color: #e0e0e0;
                }

                .bili-image-selector__controls button {
                    background: #2a2a2a;
                    color: #0095d2;
                    border-color: #0095d2;
                }

                .bili-image-selector__controls button:hover {
                    background: #0095d2;
                    color: white;
                }

                .bili-image-selector__cancel {
                    background: #2a2a2a;
                    color: #aaa;
                    border-color: #555;
                }

                .bili-image-selector__cancel:hover {
                    background: #3a3a3a;
                }

                .bili-image-selector__download {
                    background: #0095d2;
                    border-color: #0095d2;
                }

                .bili-image-selector__download:hover:not(:disabled) {
                    background: #00a7e9;
                }
            }
        `;

        document.head.appendChild(style);
    }

    // Show notification
    showNotification(message, type = 'info') {
        try {
            // Remove existing notification
            const existing = document.querySelector('.bili-download-notification');
            if (existing) {
                existing.remove();
            }

            // Create notification
            const notification = document.createElement('div');
            notification.className = `bili-download-notification bili-download-notification--${type}`;
            notification.textContent = message;

            // Add styles if not exists
            if (!document.querySelector('#bili-notification-styles')) {
                const style = document.createElement('style');
                style.id = 'bili-notification-styles';
                style.textContent = `
                    .bili-download-notification {
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        padding: 12px 16px;
                        border-radius: 6px;
                        color: white;
                        font-size: 14px;
                        z-index: 10001;
                        opacity: 0;
                        transform: translateX(100%);
                        transition: all 0.3s ease;
                        max-width: 300px;
                    }

                    .bili-download-notification.show {
                        opacity: 1;
                        transform: translateX(0);
                    }

                    .bili-download-notification--info {
                        background: #0087BD;
                    }

                    .bili-download-notification--success {
                        background: #52c41a;
                    }

                    .bili-download-notification--warning {
                        background: #faad14;
                    }

                    .bili-download-notification--error {
                        background: #ff4d4f;
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(notification);

            // Show notification
            requestAnimationFrame(() => {
                notification.classList.add('show');
            });

            // Auto hide
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, 3000);

        } catch (error) {
            console.error('Failed to show notification:', error);
        }
    }

    // Start download process from sidebar button
    async startDownloadFromSidebar() {
        if (this.isDownloading) return;

        try {
            // Check if extension context is valid
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
                    this.isDownloading = false;
                }, 3000);
                return;
            }

            // Add download count limit info
            const maxDownloads = settings.maxDownloads || 0;
            let statusText = `找到 ${dynamics.length} 条动态`;
            
            // If limit is applied and actual count exceeds limit, show hint
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
                
                // Don't reset isDownloading here - let the background script handle completion
                console.log('Download task sent to background script from sidebar');
                
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
                this.isDownloading = false;
            }, 3000);
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

        // Update main button text
        this.updateDownloadButtonText(isDownloading);

        if (isDownloading) {
            this.downloadButton.classList.add('downloading');
        } else {
            this.downloadButton.classList.remove('downloading');
        }
    }
    
    // Update main download button text
    updateDownloadButtonText(isDownloading) {
        if (!this.downloadButton || !document.body.contains(this.downloadButton)) return;

        const textEl = this.downloadButton.querySelector('.side-nav__item__main-text');
        if (textEl) {
            textEl.textContent = isDownloading ? '暂停' : '下载图片';
                }
    }
    
    // Stop download process from sidebar button
    stopDownloadFromSidebar() {
        if (!this.isDownloading) return;

        try {
            // Send stop message to background script
            chrome.runtime.sendMessage({ type: 'stopDownload' });
            
            this.updateDownloadStatus('正在停止...', false);
            this.isDownloading = false;
            
            console.log('Stop download requested from sidebar');
            
        } catch (error) {
            console.error('Failed to stop download:', error);
            this.updateDownloadStatus('停止失败', false);
            setTimeout(() => {
                this.updateDownloadStatus('就绪', false);
            }, 3000);
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
                    // Update sidebar button status and reset downloading state
                    const data = message.data;
                    if (data.stopped) {
                        this.updateDownloadStatus('已停止', false);
                    } else {
                        this.updateDownloadStatus(`完成! ${data.success} 成功`, false);
                    }
                    // Reset downloading state immediately
                    this.isDownloading = false;
                    setTimeout(() => {
                        this.updateDownloadStatus('就绪', false);
                    }, 5000);
                    sendResponse({ success: true });
                    break;
                case 'downloadError':
                    // Handle download error and reset state
                    this.updateDownloadStatus('下载失败', false);
                    this.isDownloading = false;
                    setTimeout(() => {
                        this.updateDownloadStatus('就绪', false);
                    }, 3000);
                    sendResponse({ success: true });
                    break;
                case 'openSettingsFromSidebar':
                    // This is a fallback for browsers that don't support chrome.action.openPopup
                    // Show a notification to the user
                    this.showSettingsNotification();
                    sendResponse({ success: true });
                    break;
                case 'imageDownloaded':
                    // Handle individual image download success
                    this.showNotification(
                        `图片下载成功 (${message.index}/${message.total}): ${message.filename}`,
                        'success'
                    );
                    sendResponse({ success: true });
                    break;
                case 'imageDownloadError':
                    // Handle individual image download error
                    this.showNotification(
                        `图片下载失败 (${message.index}/${message.total}): ${message.error}`,
                        'error'
                    );
                    sendResponse({ success: true });
                    break;
                case 'selectedImagesDownloadComplete':
                    // Handle completion of selected images download
                    this.showNotification(
                        `所有选中图片下载完成 (共 ${message.total} 张)`,
                        'success'
                    );
                    sendResponse({ success: true });
                    break;
                case 'selectedImagesDownloadError':
                    // Handle error in selected images download
                    this.showNotification(
                        `选中图片下载失败: ${message.error}`,
                        'error'
                    );
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
            
            // Check if we're on a dynamic detail page
            if (window.location.hostname === 'www.bilibili.com' && window.location.pathname.startsWith('/opus/')) {
                // Handle dynamic detail page
                const dynamicInfo = await this.extractDetailPageDynamicInfo(settings);
                if (dynamicInfo) {
                    dynamics.push(dynamicInfo);
                }
                console.log(`Detail page dynamic extraction: ${dynamicInfo ? 'found 1 dynamic' : 'no valid dynamic'}`);
                return dynamics;
            } else if (window.location.hostname === 't.bilibili.com') {
                // Check if it's a detail page on t.bilibili.com (format: t.bilibili.com/[dynamic_id])
                const pathParts = window.location.pathname.split('/').filter(part => part);
                if (pathParts.length === 1 && /^\d+$/.test(pathParts[0])) {
                    // This is a detail page on t.bilibili.com
                    const dynamicInfo = await this.extractDetailPageDynamicInfo(settings);
                    if (dynamicInfo) {
                        dynamics.push(dynamicInfo);
                    }
                    console.log(`Detail page dynamic extraction: ${dynamicInfo ? 'found 1 dynamic' : 'no valid dynamic'}`);
                    return dynamics;
                } else {
                    // This is a list page on t.bilibili.com
                    dynamicCards = document.querySelectorAll('.bili-dyn-list .bili-dyn-item, .bili-opus-view');
                }
            } else if (window.location.hostname === 'space.bilibili.com') {
                dynamicCards = document.querySelectorAll('.bili-dyn-list .bili-dyn-item, .bili-opus-view');
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

    // Extract information from dynamic detail page
    async extractDetailPageDynamicInfo(settings) {
        try {
            // Extract dynamic ID from URL
            let dynamicId = null;
            if (window.location.hostname === 'www.bilibili.com' && window.location.pathname.startsWith('/opus/')) {
                // Extract from opus URL: /opus/[dynamic_id]
                const pathParts = window.location.pathname.split('/');
                if (pathParts.length >= 3) {
                    dynamicId = pathParts[2];
                }
            } else if (window.location.hostname === 't.bilibili.com') {
                // Extract from t.bilibili.com URL: /[dynamic_id]
                const pathParts = window.location.pathname.split('/').filter(part => part);
                if (pathParts.length === 1 && /^\d+$/.test(pathParts[0])) {
                    dynamicId = pathParts[0];
                }
            }

            if (!dynamicId) {
                console.log('Could not extract dynamic ID from URL');
                return null;
            }

            // Check if already downloaded
            if (settings.skipDownloaded && this.downloadedIds.has(dynamicId)) {
                console.log(`Skipping downloaded dynamic: ${dynamicId}`);
                return null;
            }

            // Check if contains images (detail page specific selectors)
            const selectors = [
                '.opus-module-album',
                '.opus-album', 
                '.bili-album',
                '.bili-dyn-gallery',
                '.bili-album__preview__picture',
                '.opus-module-top .horizontal-scroll-album',
                '.horizontal-scroll-album',
                'img[src*="i0.hdslb.com"]',
                'img[src*="i1.hdslb.com"]',
                'img[src*="bfs/new_dyn"]',
                'img[src*="bfs/album"]'
            ];
            
            let hasImages = false;
            let foundSelector = '';
            
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    hasImages = true;
                    foundSelector = selector;
                    console.log(`Found images using selector: ${selector}`);
                    break;
                }
            }

            if (!hasImages) {
                console.log(`Detail page dynamic has no images, skipping: ${dynamicId}`);
                console.log('Checked selectors:', selectors);
                // Additional debug: check what elements are actually present
                console.log('Available elements:');
                console.log('- .opus-module-top:', !!document.querySelector('.opus-module-top'));
                console.log('- .horizontal-scroll-album:', !!document.querySelector('.horizontal-scroll-album'));
                console.log('- imgs with hdslb:', document.querySelectorAll('img[src*="hdslb.com"]').length);
                return null;
            }

            // Get user information (detail page specific selectors)
            const userNameEl = document.querySelector('.bili-opus-header .bili-user-profile .bili-user-profile-name') ||
                              document.querySelector('.opus-module-author .opus-module-author__name') ||
                              document.querySelector('.bili-dyn-item__author__name') ||
                              document.querySelector('.bili-dyn-author__name') ||
                              document.querySelector('.name');
            const userName = userNameEl ? userNameEl.textContent.trim() : '';

            // Get dynamic content (detail page specific selectors)
            const contentEl = document.querySelector('.opus-module-content') ||
                             document.querySelector('.bili-rich-text__content') ||
                             document.querySelector('.bili-dyn-content__text') ||
                             document.querySelector('.content');
            const content = contentEl ? contentEl.textContent.trim() : '';

            // Get publish time (detail page specific selectors)
            const timeEl = document.querySelector('.bili-opus-header .bili-opus-header__info__time') ||
                          document.querySelector('.opus-module-author__pub__text') ||
                          document.querySelector('.bili-dyn-time') ||
                          document.querySelector('[data-time]');
            let timestamp = null;
            if (timeEl) {
                const timeText = timeEl.textContent.trim();
                timestamp = this.parseTimeToTimestamp(timeText);
            }

            console.log(`Detail page extracted - ID: ${dynamicId}, User: ${userName}, Content: ${content.substring(0, 50)}...`);

            return {
                dynamicId,
                userName,
                content,
                timestamp,
                originalElement: document.body // Use document body as reference for detail page
            };

        } catch (error) {
            console.error('Failed to extract detail page dynamic info:', error);
            return null;
        }
    }

    // Extract information from single dynamic card
    async extractDynamicInfo(card, settings) {
        try {
            // Try to find dynamic ID from different sources
            let dynamicId = null;
            let opusCard = card.querySelector('[dyn-id]');
            
            if (opusCard) {
                dynamicId = opusCard.getAttribute('dyn-id');
            } else {
                // For new opus-view format, try to extract from URL or other attributes
                const currentUrl = window.location.href;
                if (currentUrl.includes('/opus/')) {
                    const pathParts = currentUrl.split('/opus/');
                    if (pathParts.length > 1) {
                        dynamicId = pathParts[1].split('?')[0].split('#')[0];
                    }
                }
            }

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

            // Check if contains images (support both old and new dynamic formats)
            const hasImages = card.querySelector('.bili-album') || 
                             card.querySelector('.bili-dyn-gallery') ||
                             card.querySelector('.bili-album__preview__picture') ||
                             card.querySelector('.opus-module-content .bili-album') ||
                             card.querySelector('.bili-opus-view .bili-album') ||
                             card.querySelector('.opus-module-top .horizontal-scroll-album');

            if (!hasImages) {
                console.log(`Dynamic has no images, skipping: ${dynamicId}`);
                return null;
            }

            // Get user information (support both old and new dynamic formats)
            const userNameEl = card.querySelector('.bili-dyn-item__author__name') ||
                              card.querySelector('.bili-dyn-author__name') ||
                              card.querySelector('.opus-module-author__name');
            const userName = userNameEl ? userNameEl.textContent.trim() : '';

            // Get dynamic content (support both old and new dynamic formats)
            const contentEl = card.querySelector('.bili-rich-text__content') ||
                             card.querySelector('.bili-dyn-content__text') ||
                             card.querySelector('.opus-module-content p');
            const content = contentEl ? contentEl.textContent.trim() : '';

            // Get publish time (support both old and new dynamic formats)
            const timeEl = card.querySelector('.bili-dyn-time') ||
                          card.querySelector('.opus-module-author__pub__text');
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