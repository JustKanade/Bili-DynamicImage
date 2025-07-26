// Background service worker for handling download logic
class BilibiliDownloadManager {
    constructor() {
        this.isDownloading = false;
        this.downloadStopped = false;
        this.currentDownloadTask = null;
        this.downloadStats = {
            total: 0,
            current: 0,
            success: 0,
            failed: 0
        };
        this.init();
    }

    init() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sendResponse);
            return true;
        });
    }

    // Handle messages from popup
    async handleMessage(message, sendResponse) {
        try {
            switch (message.type) {
                case 'startDownload':
                    await this.startDownload(message.dynamics, message.settings);
                    sendResponse({ success: true });
                    break;
                case 'stopDownload':
                    this.stopDownload();
                    sendResponse({ success: true });
                    break;
                case 'openPopup':
                    // Open the popup and auto-expand settings
                    this.openPopupWithSettings();
                    sendResponse({ success: true });
                    break;
                default:
                    sendResponse({ success: false, error: '未知消息类型' });
            }
        } catch (error) {
            console.error('消息处理失败:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    // Open popup and auto-expand settings
    async openPopupWithSettings() {
        try {
            // Store a flag in local storage to indicate settings should be expanded
            await chrome.storage.local.set({ 'autoExpandSettings': true });
            
            // Open the popup
            if (chrome.action && chrome.action.openPopup) {
                chrome.action.openPopup();
            } else {
                console.log('chrome.action.openPopup is not available in this browser');
                
                // Alternative approach for browsers that don't support openPopup
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, { type: 'openSettingsFromSidebar' });
                }
            }
        } catch (error) {
            console.error('Failed to open popup:', error);
        }
    }

    // Start download task
    async startDownload(dynamics, settings) {
        if (this.isDownloading) {
            return;
        }

        this.isDownloading = true;
        this.downloadStopped = false;
        this.downloadStats = {
            total: dynamics.length,
            current: 0,
            success: 0,
            failed: 0
        };

        console.log(`开始下载任务，共 ${dynamics.length} 条动态`);

        try {
            for (let i = 0; i < dynamics.length && !this.downloadStopped; i++) {
                const dynamic = dynamics[i];
                this.downloadStats.current = i + 1;

                this.sendProgressUpdate(dynamic.userName || '未知用户', '获取动态详情...');

                try {
                    await this.downloadDynamic(dynamic, settings);
                    this.downloadStats.success++;
                    
                    await this.markAsDownloaded(dynamic.dynamicId);

                } catch (error) {
                    console.error(`动态 ${dynamic.dynamicId} 下载失败:`, error);
                    this.downloadStats.failed++;
                    this.sendProgressUpdate(dynamic.userName || '未知用户', '下载失败: ' + error.message);
                }

                // Download interval
                if (i < dynamics.length - 1 && !this.downloadStopped) {
                    await this.sleep(settings.downloadInterval || 2);
                }
            }

            this.downloadComplete();

        } catch (error) {
            console.error('下载任务失败:', error);
            this.sendError(error.message);
        } finally {
            this.isDownloading = false;
        }
    }

    // Download single dynamic
    async downloadDynamic(dynamic, settings) {
        try {
            const dynamicDetail = await this.getDynamicDetail(dynamic.dynamicId);
            
            if (!dynamicDetail || !dynamicDetail.data) {
                throw new Error('获取动态详情失败');
            }

            const cardData = JSON.parse(dynamicDetail.data.card.card);
            
            // Handle different dynamic types
            switch (dynamicDetail.data.card.desc.type) {
                case 2: // Image dynamic
                    await this.handleImageDynamic(cardData, dynamicDetail.data, settings);
                    break;
                case 64: // Article
                    await this.handleArticleDynamic(cardData, dynamicDetail.data, settings);
                    break;
                default:
                    console.log(`不支持的动态类型: ${dynamicDetail.data.card.desc.type}`);
                    break;
            }

        } catch (error) {
            throw new Error(`处理动态失败: ${error.message}`);
        }
    }

    // Handle image dynamics
    async handleImageDynamic(card, data, settings) {
        const pictures = card.item?.pictures;
        
        if (!Array.isArray(pictures) || pictures.length === 0) {
            throw new Error('动态中未找到图片');
        }

        console.log(`找到 ${pictures.length} 张图片`);

        for (let index = 0; index < pictures.length; index++) {
            if (this.downloadStopped) break;

            const picture = pictures[index];
            const pictureUrl = picture.img_src;
            
            if (!pictureUrl) {
                console.warn(`图片 ${index + 1} 缺少URL`);
                continue;
            }

            const originalName = this.extractFilename(pictureUrl);
            const pictureName = this.generateFileName(settings.fileNamePattern, originalName, index + 1, data);

            this.sendProgressUpdate(`图片 ${index + 1}/${pictures.length}`, '下载中...');

            try {
                await this.downloadFile(pictureUrl, pictureName, settings);
                console.log(`下载成功: ${pictureName}`);
            } catch (error) {
                console.error(`图片下载失败: ${pictureName}`, error);
                throw error;
            }
        }
    }

    // Handle article dynamics
    async handleArticleDynamic(card, data, settings) {
        const pictures = card.image_urls;
        
        if (!Array.isArray(pictures) || pictures.length === 0) {
            throw new Error('文章中未找到图片');
        }

        console.log(`找到 ${pictures.length} 张图片`);

        for (let index = 0; index < pictures.length; index++) {
            if (this.downloadStopped) break;

            const pictureUrl = pictures[index];
            
            if (!pictureUrl) {
                console.warn(`图片 ${index + 1} 缺少URL`);
                continue;
            }

            const originalName = this.extractFilename(pictureUrl);
            const pictureName = this.generateFileName(settings.fileNamePattern, originalName, index + 1, data);

            this.sendProgressUpdate(`图片 ${index + 1}/${pictures.length}`, '下载中...');

            try {
                await this.downloadFile(pictureUrl, pictureName, settings);
                console.log(`下载成功: ${pictureName}`);
            } catch (error) {
                console.error(`图片下载失败: ${pictureName}`, error);
                throw error;
            }
        }
    }

    // Get dynamic details from API
    async getDynamicDetail(dynamicId) {
        const url = `https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/get_dynamic_detail?dynamic_id=${dynamicId}`;
        
        try {
            const response = await fetch(url, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.code !== 0) {
                throw new Error(`API错误: ${result.message || '未知错误'}`);
            }

            return result;

        } catch (error) {
            throw new Error(`请求动态详情失败: ${error.message}`);
        }
    }

    // Download file using Chrome downloads API
    async downloadFile(url, filename, settings) {
        // 构建完整的文件路径，包含用户指定的下载路径
        let fullPath = filename;
        
        // 如果设置了下载路径，添加到文件名前面
        if (settings && settings.downloadPath && settings.downloadPath.trim() !== '') {
            // 确保路径末尾有斜杠
            let path = settings.downloadPath.trim();
            if (!path.endsWith('/')) {
                path += '/';
            }
            fullPath = path + filename;
        }
        
        return new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: url,
                filename: fullPath
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (downloadId) {
                    resolve(downloadId);
                } else {
                    reject(new Error('下载失败: 未收到下载ID'));
                }
            });
        });
    }

    // Generate filename based on pattern
    generateFileName(pattern, originalName, index, data) {
        try {
            const card = JSON.parse(data.card.card);
            let fileName = pattern;

            // Replace basic info
            fileName = fileName.replace('{original}', originalName.split('.')[0]);
            fileName = fileName.replace('{ext}', originalName.split('.').pop());
            fileName = fileName.replace('{index}', index.toString());

            // Replace user info
            const userName = card.user?.name || data.card.desc.user_profile?.info?.uname || '未知用户';
            const userId = card.user?.uid || data.card.desc.user_profile?.info?.uid || '0';
            fileName = fileName.replace('{username}', userName);
            fileName = fileName.replace('{userid}', userId.toString());

            // Replace dynamic info
            const dynamicId = data.card.desc.dynamic_id_str;
            const content = card.item?.description || card.title || '';
            fileName = fileName.replace('{dynamicid}', dynamicId);
            fileName = fileName.replace('{content}', content.substring(0, 25));

            // Replace time info
            const timestamp = card.item?.upload_time || data.card.desc.timestamp;
            const date = new Date(timestamp * 1000);
            fileName = fileName.replace('{YYYY}', date.getFullYear().toString());
            fileName = fileName.replace('{MM}', (date.getMonth() + 1).toString().padStart(2, '0'));
            fileName = fileName.replace('{DD}', date.getDate().toString().padStart(2, '0'));
            fileName = fileName.replace('{HH}', date.getHours().toString().padStart(2, '0'));
            fileName = fileName.replace('{mm}', date.getMinutes().toString().padStart(2, '0'));
            fileName = fileName.replace('{ss}', date.getSeconds().toString().padStart(2, '0'));

            // Clean invalid characters
            fileName = fileName.replace(/[<>:"/\\|?*\n]/g, '_');
            
            return fileName;

        } catch (error) {
            console.error('生成文件名失败:', error);
            return `${originalName.split('.')[0]}_${index}.${originalName.split('.').pop()}`;
        }
    }

    // Extract filename from URL
    extractFilename(url) {
        try {
            const urlParts = url.split('/');
            const filename = urlParts[urlParts.length - 1];
            return filename.split('?')[0];
        } catch (error) {
            return 'image.jpg';
        }
    }

    // Mark dynamic as downloaded
    async markAsDownloaded(dynamicId) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'markAsDownloaded',
                    dynamicId: dynamicId
                });
            }
        } catch (error) {
            console.error('标记已下载失败:', error);
        }
    }

    stopDownload() {
        this.downloadStopped = true;
        console.log('用户停止下载');
    }

    // Send progress update to popup and content script
    sendProgressUpdate(currentItem, status) {
        const progressData = {
            type: 'downloadProgress',
            data: {
                current: this.downloadStats.current,
                total: this.downloadStats.total,
                currentItem: currentItem,
                status: status
            }
        };

        // Send to popup
        chrome.runtime.sendMessage(progressData).catch(() => {
            // Ignore errors when popup is closed
        });

        // Send to content script (sidebar button)
        this.sendToContentScript(progressData);
    }

    // Notify download completion to popup and content script
    downloadComplete() {
        const completeData = {
            type: 'downloadComplete',
            data: {
                stopped: this.downloadStopped,
                success: this.downloadStats.success,
                failed: this.downloadStats.failed,
                total: this.downloadStats.total
            }
        };

        // Send to popup
        chrome.runtime.sendMessage(completeData).catch(() => {
            // Ignore errors when popup is closed
        });

        // Send to content script (sidebar button)
        this.sendToContentScript(completeData);
    }

    // Send message to content script
    async sendToContentScript(message) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, message).catch(() => {
                    // Ignore errors if content script is not available
                });
            }
        } catch (error) {
            // Ignore errors when tab is not accessible
        }
    }

    // Send error message
    sendError(message) {
        const errorData = {
            type: 'downloadError',
            data: message
        };
        
        // Send to popup
        chrome.runtime.sendMessage(errorData).catch(() => {
            // Ignore errors when popup is closed
        });
        
        // Send to content script (sidebar button)
        this.sendToContentScript(errorData);
    }

    sleep(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
}

new BilibiliDownloadManager(); 