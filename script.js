// iframe 管理器 - 直接嵌入视频流版本
class IframeManager {
    constructor() {
        this.devices = new Map();
        this.zoomSteps = [0.1, 1, 5, 10, 20];
        this.zoomStepIndex = 3; // 默认10%
        this.globalZoom = 30; // 全局缩放比例，默认30%
        this.mirrorModes = new Map(); // 跟踪每个 mirror 设备的模式状态
        this.mirrorCheckInterval = null; // 模式检查定时器
        this.gestureWebSockets = new Map(); // WebSocket 连接管理
        
        // 手势类型常量
        this.GESTURE_TYPES = {
            ACC: 'acc',    // 无障碍手势（默认）
            HID: 'hid'     // HID 蓝牙手势
        };
        
        this.init();
        this.startMirrorModeCheck(); // 启动模式检查
    }

    // 检测视频流类型
    detectStreamType(url) {
        // WebRTC 流检测
        if (url.includes('/webrtc') || url.includes('/webrtc/')) {
            return 'webrtc';
        }
        // MJPEG 流检测
        if (url.includes('/stream.mjpeg') || url.includes('.mjpeg')) {
            return 'mjpeg';
        }
        // 默认尝试 MJPEG
        return 'mjpeg';
    }

    // HID 命令现在通过 WebSocket 发送，不再使用 HTTP
    // 保留此方法用于兼容性，但返回 null 阻止 HTTP 调用
    getHIDUrl(deviceUrl) {
        console.warn('[HID] HTTP HID 已废弃，请使用 WebSocket 方式');
        return null;
    }

    init() {
        this.bindEvents();
        this.loadConfigs();
        // 默认折叠侧边栏
        document.getElementById('sidebar').classList.add('collapsed');
        // 默认全屏显示
        document.body.classList.add('fullscreen');
    }

    // 绑定事件
    bindEvents() {
        // 添加设备按钮
        document.getElementById('addIframe').addEventListener('click', () => {
            this.showModal();
        });

        // 清空所有
        document.getElementById('clearAll').addEventListener('click', () => {
            this.clearAllDevices();
        });

        // 模态框事件
        document.getElementById('modalClose').addEventListener('click', () => this.hideModal());
        document.getElementById('modalCancel').addEventListener('click', () => this.hideModal());
        document.getElementById('modalConfirm').addEventListener('click', () => this.confirmAdd());
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideModal();
        });

        // 确认对话框事件
        document.getElementById('confirmModalClose').addEventListener('click', () => this.hideConfirmModal());
        document.getElementById('confirmCancel').addEventListener('click', () => this.hideConfirmModal());
        document.getElementById('confirmOk').addEventListener('click', () => this.confirmDelete());
        document.getElementById('confirmModalOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideConfirmModal();
        });

        // 侧边栏整体折叠按钮
        document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed');
        });

        // 回车键确认
        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.confirmAdd();
        });

        // 全局缩放控制
        this.bindZoomControls();

        // 全屏切换按钮
        this.bindFullscreenControl();

        // 滚轮缩放
        this.bindWheelZoom();
    }

    // 绑定全屏控制
    bindFullscreenControl() {
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        fullscreenBtn.addEventListener('click', () => {
            document.body.classList.toggle('fullscreen');
            // 切换图标
            if (document.body.classList.contains('fullscreen')) {
                fullscreenBtn.textContent = '⛶';
                fullscreenBtn.title = '退出全屏';
            } else {
                fullscreenBtn.textContent = '⛶';
                fullscreenBtn.title = '全屏';
            }
        });
    }

    // 绑定滚轮缩放
    bindWheelZoom() {
        const mainContent = document.getElementById('mainContent');
        mainContent.addEventListener('wheel', (e) => {
            e.preventDefault();
            // 滚轮缩放步长 5%
            const step = 5;
            if (e.deltaY < 0) {
                // 向上滚动 - 放大
                this.globalZoom = Math.min(120, this.globalZoom + step);
            } else {
                // 向下滚动 - 缩小
                this.globalZoom = Math.max(10, this.globalZoom - step);
            }
            this.applyGlobalZoom();
        }, { passive: false });
    }

    // 绑定全局缩放控制
    bindZoomControls() {
        const zoomOut = document.getElementById('zoomOut');
        const zoomIn = document.getElementById('zoomIn');
        const zoomStep = document.getElementById('zoomStep');

        zoomOut.addEventListener('click', () => {
            const step = this.zoomSteps[parseInt(zoomStep.value)];
            this.globalZoom = Math.max(10, this.globalZoom - step);
            this.applyGlobalZoom();
        });

        zoomIn.addEventListener('click', () => {
            const step = this.zoomSteps[parseInt(zoomStep.value)];
            this.globalZoom = Math.min(120, this.globalZoom + step);
            this.applyGlobalZoom();
        });

        zoomStep.addEventListener('change', () => {
            this.zoomStepIndex = parseInt(zoomStep.value);
        });
    }

    // 更新单个图片尺寸
    updateImageSize(img, deviceState) {
        const baseWidth = deviceState.size?.width || 720;
        const baseHeight = deviceState.size?.height || 1600;
        const scale = this.globalZoom / 100;
        // 直接设置宽高，不使用 transform
        img.style.width = `${baseWidth * scale}px`;
        img.style.height = `${baseHeight * scale}px`;
    }

    // 应用全局缩放
    applyGlobalZoom() {
        document.getElementById('zoomValue').textContent = `${this.globalZoom.toFixed(1)}%`;
        // 缩放 MJPEG 图片
        const images = document.querySelectorAll('.video-feed:not(.webrtc-canvas)');
        images.forEach(img => {
            const deviceId = img.dataset.id;
            const deviceState = this.devices.get(deviceId);
            if (deviceState) {
                this.updateImageSize(img, deviceState);
            }
        });
        // 缩放 WebRTC wrapper
        const webrtcWrappers = document.querySelectorAll('.webrtc-wrapper');
        webrtcWrappers.forEach(wrapper => {
            const deviceId = wrapper.dataset.id;
            const deviceState = this.devices.get(deviceId);
            if (deviceState) {
                this.updateWebRTCSize(wrapper, deviceState);
            }
        });
    }

    // 显示模态框
    showModal() {
        document.getElementById('modalOverlay').classList.add('active');
        document.getElementById('urlInput').value = '';
        document.getElementById('urlInput').focus();
    }

    // 隐藏模态框
    hideModal() {
        document.getElementById('modalOverlay').classList.remove('active');
    }

    // 显示确认对话框
    showConfirmModal(message, onConfirm) {
        this.confirmCallback = onConfirm;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmModalOverlay').classList.add('active');
    }

    // 隐藏确认对话框
    hideConfirmModal() {
        document.getElementById('confirmModalOverlay').classList.remove('active');
        this.confirmCallback = null;
    }

    // 确认删除
    confirmDelete() {
        if (this.confirmCallback) {
            this.confirmCallback();
        }
        this.hideConfirmModal();
    }

    // 确认添加
    confirmAdd() {
        const url = document.getElementById('urlInput').value.trim();
        if (!url) {
            alert('请输入视频流地址');
            return;
        }
        this.addDevice(url);
        this.hideModal();
    }

    // 获取设备标题（ip:port）
    getDeviceTitle(url) {
        try {
            let cleanUrl = url.replace(/^https?:\/\//i, '');
            const match = cleanUrl.match(/^([^\/]+)/);
            return match ? match[1] : cleanUrl;
        } catch {
            return url;
        }
    }

    // 添加设备
    addDevice(url) {
        const id = Date.now().toString();
        const title = this.getDeviceTitle(url);

        // 自动添加 http:// 前缀（如果没有协议）
        let fullUrl = url;
        if (!url.match(/^https?:\/\//i)) {
            fullUrl = 'http://' + url;
        }

        // 检测视频流类型
        const streamType = this.detectStreamType(fullUrl);

        console.log('[调试] 添加设备:', { id, title, url: fullUrl, streamType });

        const deviceState = {
            id,
            url: fullUrl,
            title,
            streamType,
            toolsCollapsed: false, // 工具组默认展开
            size: { width: 720, height: 1600 } // 默认设备尺寸
        };

        this.devices.set(id, deviceState);

        // 创建设备列表项（包含工具组）
        this.createDeviceItem(deviceState);

        // 创建视频窗口
        this.createVideoWindow(deviceState);

        // 保存配置
        this.saveConfigs();
    }

    // 创建设备列表项（包含可折叠的工具组）
    createDeviceItem(deviceState) {
        const sidebarContent = document.getElementById('sidebarContent');

        const item = document.createElement('div');
        item.className = 'device-item';
        item.dataset.id = deviceState.id;
        if (deviceState.toolsCollapsed) {
            item.classList.add('collapsed');
        }

        // 设备标题栏
        const header = document.createElement('div');
        header.className = 'device-header';
        header.innerHTML = `
            <button class="device-toggle-btn" title="展开/折叠工具">▼</button>
            <span class="device-name">${deviceState.title}</span>
            <button class="device-delete" title="删除">×</button>
        `;

        // 工具面板
        const tools = document.createElement('div');
        tools.className = 'device-tools';
        tools.innerHTML = `
            <div class="tool-row">
                <button class="tool-btn" data-action="up" title="上">⬆️</button>
                <button class="tool-btn" data-action="down" title="下">⬇️</button>
                <button class="tool-btn" data-action="left" title="左">⬅️</button>
                <button class="tool-btn" data-action="right" title="右">➡️</button>
            </div>
            <div class="tool-row">
                <button class="tool-btn" data-action="home" title="Home">🏠</button>
                <button class="tool-btn" data-action="task" title="Task">📋</button>
                <button class="tool-btn" data-action="back" title="Back">↩️</button>
                <button class="tool-btn primary" data-action="click" title="Click">👆</button>
            </div>
        `;

        item.appendChild(header);
        item.appendChild(tools);
        sidebarContent.appendChild(item);

        // 绑定事件
        this.bindDeviceItemEvents(item, deviceState);
    }

    // 绑定设备项事件
    bindDeviceItemEvents(item, deviceState) {
        const toggleBtn = item.querySelector('.device-toggle-btn');
        const deleteBtn = item.querySelector('.device-delete');

        // 折叠/展开工具组
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            item.classList.toggle('collapsed');
            deviceState.toolsCollapsed = item.classList.contains('collapsed');
            this.saveConfigs();
        });

        // 删除设备
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showConfirmModal(`是否要删除设备 ${deviceState.title}？`, () => {
                this.removeDevice(deviceState.id);
            });
        });

        // 绑定工具按钮事件
        this.bindToolEvents(item, deviceState);
    }

    // 绑定工具按钮事件
    bindToolEvents(item, deviceState) {
        // 工具按钮点击
        item.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;

                switch(action) {
                    case 'up':
                    case 'down':
                    case 'left':
                    case 'right':
                    case 'home':
                    case 'task':
                    case 'back':
                        this.sendHIDCommand(action, deviceState);
                        break;
                }
            });
        });
    }

    // 创建视频窗口（直接嵌入视频流）
    createVideoWindow(deviceState) {
        const container = document.getElementById('mainContent');

        if (deviceState.streamType === 'webrtc') {
            // WebRTC 流 - 使用 iframe 嵌入
            this.createWebRTCWindow(deviceState, container);
        } else {
            // MJPEG 流 - 使用 img 标签
            this.createMJPEGWindow(deviceState, container);
        }

        console.log('[调试] 视频窗口已创建:', deviceState.id, '类型:', deviceState.streamType);
    }

    // 创建 MJPEG 视频窗口
    createMJPEGWindow(deviceState, container) {
        // 检查是否是 mirror 设备
        const isMirror = deviceState.url.includes('/mirror');
        
        // 视频容器
        const wrapper = document.createElement('div');
        wrapper.className = 'video-feed-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-block';
        
        // 视频图片元素
        const img = document.createElement('img');
        img.className = 'video-feed';
        img.alt = deviceState.title;
        img.dataset.id = deviceState.id;
        img.dataset.url = deviceState.url;

        // 设置视频流地址
        console.log('[调试] 设置 MJPEG 视频源:', deviceState.url);
        img.src = deviceState.url;

        // 图片加载完成后，设置尺寸（根据全局缩放）
        img.onload = () => {
            this.updateImageSize(img, deviceState);
            console.log('[调试] MJPEG 图片加载完成，应用全局缩放:', this.globalZoom);
            
            // mirror 设备：不显示状态提示，仅控制台日志
        };

        // 加载失败显示错误
        img.onerror = (e) => {
            console.error('[调试] MJPEG 视频加载失败:', deviceState.url, e);
            // 不显示红色边框和弹出提示，仅控制台日志
        };

        // 点击发送 click 命令
        this.bindClickEvent(img, deviceState);

        wrapper.appendChild(img);
        container.appendChild(wrapper);
        
        // 如果是 mirror 设备，添加手势触摸层和 WebSocket 连接
        if (isMirror) {
            this.initMirrorDevice(deviceState, img, wrapper);
            // 初始化手势类型（默认无障碍）
            deviceState.gestureType = deviceState.gestureType || this.GESTURE_TYPES.ACC;
            // 初始化手势连接
            this.initGestureConnection(deviceState);
            this.addGestureOverlay(deviceState, wrapper, img);
            this.addGestureTypeSwitcher(deviceState, wrapper);
        }
    }

    // 创建 WebRTC 视频窗口
    createWebRTCWindow(deviceState, container) {
        // WebRTC 使用 iframe 嵌入整个页面（由于跨域限制，无法提取 canvas）
        const wrapper = document.createElement('div');
        wrapper.className = 'video-feed webrtc-wrapper';
        wrapper.dataset.id = deviceState.id;

        const iframe = document.createElement('iframe');
        iframe.className = 'webrtc-iframe';
        iframe.src = deviceState.url;
        iframe.allow = 'autoplay; fullscreen';
        iframe.style.border = 'none';

        wrapper.appendChild(iframe);
        container.appendChild(wrapper);

        // 设置尺寸
        this.updateWebRTCSize(wrapper, deviceState);

        console.log('[调试] WebRTC iframe 创建完成，应用全局缩放:', this.globalZoom);
    }

    // 更新 WebRTC 尺寸
    updateWebRTCSize(wrapper, deviceState) {
        const baseWidth = deviceState.size?.width || 720;
        const baseHeight = deviceState.size?.height || 1600;
        const scale = this.globalZoom / 100;
        wrapper.style.width = `${baseWidth * scale}px`;
        wrapper.style.height = `${baseHeight * scale}px`;
        // 同时设置内部 iframe 尺寸
        const iframe = wrapper.querySelector('.webrtc-iframe');
        if (iframe) {
            iframe.style.width = '100%';
            iframe.style.height = '100%';
        }
    }

    // 绑定点击事件
    bindClickEvent(img, deviceState) {
        let mouseDownTime = 0;
        img.addEventListener('mousedown', (e) => {
            mouseDownTime = Date.now();
        });
        img.addEventListener('mouseup', (e) => {
            const duration = Date.now() - mouseDownTime;

            // 计算点击位置相对于图片的百分比
            const rect = img.getBoundingClientRect();
            const percentX = (e.clientX - rect.left) / rect.width;
            const percentY = (e.clientY - rect.top) / rect.height;

            // 获取设备尺寸（从缓存或默认值）
            const deviceSize = deviceState.size || { width: 720, height: 1600 };

            // 计算实际坐标（百分比 * 设备尺寸，四舍五入）
            const x = Math.round(percentX * deviceSize.width);
            const y = Math.round(percentY * deviceSize.height);

            console.log('[HID Click] 百分比:', percentX.toFixed(2), percentY.toFixed(2),
                        '坐标:', x, y, '延迟:', duration, '设备尺寸:', deviceSize);

            this.sendHIDCommand('click', deviceState, { x, y, duration });
        });
    }

    // 发送 HID 命令（公共方法）- 现在通过 WebSocket 发送
    async sendHIDCommand(action, deviceState, clickData = null) {
        // 构建命令
        let command = '';
        switch(action) {
            case 'up': command = 'sw:2'; break;
            case 'down': command = 'sw:3'; break;
            case 'left': command = 'sw:0'; break;
            case 'right': command = 'sw:1'; break;
            case 'home': command = 'fun:home'; break;
            case 'task': command = 'fun:task'; break;
            case 'back': command = 'fun:back'; break;
            case 'click':
                if (clickData) {
                    command = `cl:${clickData.x},${clickData.y},${clickData.duration}`;
                }
                break;
        }

        if (command) {
            this.sendHidCommandViaWebSocket(deviceState.id, command);
        }
    }

    // 通过 WebSocket 发送 HID 命令
    sendHidCommandViaWebSocket(deviceId, command) {
        const ws = this.gestureWebSockets?.get(deviceId);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('[HID] WebSocket 未连接，无法发送命令:', command);
            return false;
        }

        const message = JSON.stringify({
            type: 'hid_command',
            command: command,
            timestamp: Date.now()
        });

        console.log('[HID] 通过 WebSocket 发送:', command);
        ws.send(message);
        return true;
    }

    // 删除设备
    removeDevice(id) {
        console.log('[调试] 删除设备:', id);
        
        // 如果是 mirror 设备，停止定时刷新并从跟踪列表中移除
        if (this.mirrorModes.has(id)) {
            this.stopMirrorRefresh(id);
            this.mirrorModes.delete(id);
        }
        
        // 断开手势 WebSocket 连接
        this.disconnectGestureWebSocket(id);

        // 从 Map 中删除
        this.devices.delete(id);

        // 删除设备列表项
        const deviceItem = document.querySelector(`.device-item[data-id="${id}"]`);
        if (deviceItem) deviceItem.remove();

        // 删除视频元素（MJPEG img 或 WebRTC iframe）
        const videoElement = document.querySelector(`.video-feed[data-id="${id}"]`);
        if (videoElement) videoElement.remove();

        // 保存配置
        this.saveConfigs();
    }

    // 清空所有设备
    clearAllDevices() {
        if (this.devices.size === 0) return;

        this.showConfirmModal('确定要删除所有设备吗？', () => {
            console.log('[调试] 清空所有设备');
            this.devices.clear();
            document.getElementById('sidebarContent').innerHTML = '';
            document.getElementById('mainContent').innerHTML = '';
            this.saveConfigs();
        });
    }

    // 保存配置到 localStorage
    saveConfigs() {
        const configs = Array.from(this.devices.values()).map(device => ({
            id: device.id,
            url: device.url,
            title: device.title,
            streamType: device.streamType,
            toolsCollapsed: device.toolsCollapsed,
            size: device.size,
            gestureType: device.gestureType || this.GESTURE_TYPES.ACC
        }));
        localStorage.setItem('videoConfigs', JSON.stringify(configs));
        console.log('[调试] 配置已保存, 设备数:', configs.length);
    }

    // 从 localStorage 加载配置
    loadConfigs() {
        try {
            const configs = JSON.parse(localStorage.getItem('videoConfigs') || '[]');
            console.log('[调试] 加载配置, 设备数:', configs.length);

            configs.forEach(config => {
                const deviceState = {
                    id: config.id || Date.now().toString(),
                    url: config.url,
                    title: config.title || this.getDeviceTitle(config.url),
                    streamType: config.streamType || this.detectStreamType(config.url),
                    toolsCollapsed: config.toolsCollapsed || false,
                    size: config.size || { width: 720, height: 1600 },
                    gestureType: config.gestureType || this.GESTURE_TYPES.ACC
                };

                this.devices.set(deviceState.id, deviceState);
                this.createDeviceItem(deviceState);
                this.createVideoWindow(deviceState);
            });
        } catch (e) {
            console.error('[调试] 加载配置失败:', e);
        }
    }

    // ========== Mirror 设备自动刷新相关方法 ==========

    // 初始化 mirror 设备
    initMirrorDevice(deviceState, img, wrapper) {
        const deviceId = deviceState.id;
        // 提取 IP 和端口，确保使用 8888 端口（主 HTTP 服务）
        const urlMatch = deviceState.url.match(/^(https?:\/\/[^\/]+)/);
        let baseUrl = urlMatch ? urlMatch[1] : deviceState.url.replace('/mirror', '');
        
        // 强制替换为 8888 端口（主 HTTP 服务端口）
        baseUrl = baseUrl.replace(/:\d+/, ':8888');
        
        // 存储设备信息
        this.mirrorModes.set(deviceId, {
            currentMode: null,
            img: img,
            wrapper: wrapper,
            baseUrl: baseUrl,
            triggerRefreshUrl: null, // scrcpy-server 的 trigger-refresh URL（从 status 获取）
            refreshInterval: null, // 定时刷新器
            lastFrameTime: Date.now(), // 最后一帧时间
            frameCheckInterval: null // 帧率检测定时器
        });
        
        console.log('[Mirror] 初始化 mirror 设备:', deviceId, baseUrl);
        
        // 启动帧率检测（每3秒检查一次帧率）
        this.startFrameRateCheck(deviceId);
    }
    
    // 启动帧率检测
    startFrameRateCheck(deviceId) {
        const mirrorInfo = this.mirrorModes.get(deviceId);
        if (!mirrorInfo || mirrorInfo.frameCheckInterval) return;
        
        // 使用 canvas 检测帧更新（MJPEG 的 onload 只在初始加载触发）
        let lastImageData = null;
        const checkFrameUpdate = () => {
            if (!mirrorInfo.img || !mirrorInfo.img.complete) return;
            
            try {
                // 创建临时 canvas 比较当前帧
                const canvas = document.createElement('canvas');
                canvas.width = 10;
                canvas.height = 10;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(mirrorInfo.img, 0, 0, 10, 10);
                const imageData = canvas.toDataURL('image/jpeg', 0.1);
                
                // 如果图像数据变化，说明有新帧
                if (imageData !== lastImageData) {
                    lastImageData = imageData;
                    mirrorInfo.lastFrameTime = Date.now();
                }
            } catch (e) {
                // 跨域或 other 错误，使用简单的时间戳比较
                mirrorInfo.lastFrameTime = Date.now();
            }
        };
        
        // 每 500ms 检查一次帧更新
        mirrorInfo.frameCheckInterval = setInterval(checkFrameUpdate, 500);
        
        // 同时保留定期检查（用于检测长时间静止）
        mirrorInfo.healthCheckInterval = setInterval(async () => {
            await this.checkFrameRate(deviceId);
        }, 5000);
        
        console.log('[Mirror] 启动帧率检测:', deviceId);
    }
    
    // 停止帧率检测
    stopFrameRateCheck(deviceId) {
        const mirrorInfo = this.mirrorModes.get(deviceId);
        if (mirrorInfo) {
            if (mirrorInfo.frameCheckInterval) {
                clearInterval(mirrorInfo.frameCheckInterval);
                mirrorInfo.frameCheckInterval = null;
            }
            if (mirrorInfo.healthCheckInterval) {
                clearInterval(mirrorInfo.healthCheckInterval);
                mirrorInfo.healthCheckInterval = null;
            }
            console.log('[Mirror] 停止帧率检测:', deviceId);
        }
    }
    
    // 检查帧率，静止时触发刷新
    async checkFrameRate(deviceId) {
        const mirrorInfo = this.mirrorModes.get(deviceId);
        if (!mirrorInfo) return;
        
        // 先检查模式状态
        try {
            const statusUrl = `${mirrorInfo.baseUrl}/mirror/status`;
            const response = await fetch(statusUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(3000)
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // 如果模式未运行，触发恢复
                if (!data.isActive && data.currentMode !== 'none') {
                    console.log(`[Mirror] 模式未运行，触发恢复: ${deviceId}`);
                    await this.triggerMirrorRecovery(mirrorInfo);
                    return;
                }
            }
        } catch (e) {
            console.log(`[Mirror] 状态检查失败: ${deviceId}`, e.message);
        }
        
        const now = Date.now();
        const timeSinceLastFrame = now - mirrorInfo.lastFrameTime;
        
        // 如果超过10秒没有新帧，认为画面静止，需要刷新
        if (timeSinceLastFrame > 10000) {
            console.log(`[Mirror] 画面静止检测: ${deviceId}, 距上一帧 ${Math.round(timeSinceLastFrame/1000)}s`);
            await this.refreshMirrorStream(deviceId);
        }
    }
    
    // 启动 mirror 设备定时刷新（仅在需要时调用）
    startMirrorRefresh(deviceId) {
        const mirrorInfo = this.mirrorModes.get(deviceId);
        if (!mirrorInfo || mirrorInfo.refreshInterval) return;
        
        // 立即执行一次刷新
        this.refreshMirrorStream(deviceId);
        
        // 每5秒继续刷新，直到画面恢复
        mirrorInfo.refreshInterval = setInterval(async () => {
            const now = Date.now();
            const timeSinceLastFrame = now - mirrorInfo.lastFrameTime;
            
            // 如果帧率恢复正常（5秒内有新帧），停止定时刷新
            if (timeSinceLastFrame < 5000) {
                console.log(`[Mirror] 画面恢复正常，停止定时刷新: ${deviceId}`);
                this.stopMirrorRefresh(deviceId);
                return;
            }
            
            await this.refreshMirrorStream(deviceId);
        }, 5000);
        
        console.log('[Mirror] 启动定时刷新:', deviceId);
    }
    
    // 停止 mirror 设备定时刷新
    stopMirrorRefresh(deviceId) {
        const mirrorInfo = this.mirrorModes.get(deviceId);
        if (mirrorInfo && mirrorInfo.refreshInterval) {
            clearInterval(mirrorInfo.refreshInterval);
            mirrorInfo.refreshInterval = null;
            console.log('[Mirror] 停止定时刷新:', deviceId);
        }
    }
    
    // 刷新 mirror 流
    async refreshMirrorStream(deviceId) {
        const mirrorInfo = this.mirrorModes.get(deviceId);
        if (!mirrorInfo) return;
        
        try {
            // 先检查当前模式
            const statusUrl = `${mirrorInfo.baseUrl}/mirror/status`;
            const response = await fetch(statusUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                // 短超时，避免阻塞
                signal: AbortSignal.timeout(3000)
            });
            
            if (!response.ok) return;
            
            const data = await response.json();
            const currentMode = data.currentMode;
            const isActive = data.isActive;
            const triggerRefreshUrl = data.triggerRefreshUrl; // 获取 scrcpy-server 的 trigger-refresh URL
            
            console.log(`[Mirror] 定时检查 ${deviceId}: mode=${currentMode}, active=${isActive}, triggerRefreshUrl=${triggerRefreshUrl}`);
            
            // 更新 trigger-refresh URL（SM 模式下使用）
            if (triggerRefreshUrl && triggerRefreshUrl !== 'N/A' && currentMode === 'sm') {
                mirrorInfo.triggerRefreshUrl = triggerRefreshUrl;
            }
            
            if (!isActive) {
                // 模式未激活，尝试恢复
                console.log(`[Mirror] 模式未激活，尝试恢复: ${deviceId}`);
                await this.triggerMirrorRecovery(mirrorInfo);
                return;
            }
            
            if (currentMode === 'sm') {
                // SM 模式：请求 /mirror 后等待 200ms 再请求 /trigger-refresh
                console.log(`[Mirror] SM 模式，执行刷新: ${deviceId}`);
                await this.refreshSmMode(mirrorInfo);
            } else if (currentMode === 'mpm') {
                // MPM 模式：只请求 /mirror
                console.log(`[Mirror] MPM 模式，执行刷新: ${deviceId}`);
                await this.refreshMpmMode(mirrorInfo);
            }
        } catch (e) {
            console.log(`[Mirror] 刷新检查失败 ${deviceId}:`, e.message);
        }
    }
    
    // 刷新 SM 模式
    async refreshSmMode(mirrorInfo) {
        try {
            // SM 模式问题：scrcpy-server 在画面静止时会停止发送帧
            // 解决方案：强制重新加载图片，让服务器重新建立连接
            
            console.log('[Mirror] SM 模式强制刷新');
            
            // 1. 先强制重新加载图片（这会中断旧连接并建立新连接）
            const timestamp = Date.now();
            const newUrl = mirrorInfo.img.dataset.url + '?t=' + timestamp;
            mirrorInfo.img.src = newUrl;
            
            // 2. 等待 500ms 让新连接建立
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 3. 请求 /mirror 确保模式活跃
            const mirrorUrl = `${mirrorInfo.baseUrl}/mirror`;
            fetch(mirrorUrl, { method: 'GET', signal: AbortSignal.timeout(3000) })
                .catch(e => console.log('[Mirror] SM /mirror 请求:', e.message));
            
            // 4. 再等待 200ms
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // 5. 请求 /mirror/trigger-refresh（使用代理接口，避免 CORS）
            const proxyRefreshUrl = `${mirrorInfo.baseUrl}/mirror/trigger-refresh`;
            console.log('[Mirror] 请求 trigger-refresh (代理):', proxyRefreshUrl);
            fetch(proxyRefreshUrl, { method: 'GET', signal: AbortSignal.timeout(5000) })
                .then(response => {
                    if (response.ok) {
                        console.log('[Mirror] Trigger-refresh 代理请求成功');
                    } else {
                        console.log('[Mirror] Trigger-refresh 代理请求失败:', response.status);
                    }
                })
                .catch(e => console.log('[Mirror] SM /trigger-refresh 代理请求:', e.message));
            
            console.log('[Mirror] SM 模式刷新完成');
        } catch (e) {
            console.log('[Mirror] SM 刷新失败:', e.message);
        }
    }
    
    // 刷新 MPM 模式
    async refreshMpmMode(mirrorInfo) {
        try {
            // 只请求 /mirror
            const mirrorUrl = `${mirrorInfo.baseUrl}/mirror`;
            const response = await fetch(mirrorUrl, { 
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            
            if (response.ok) {
                console.log('[Mirror] MPM 模式刷新成功');
                // 重新加载图片（添加时间戳防止缓存）
                const newUrl = mirrorInfo.img.dataset.url + '?t=' + Date.now();
                mirrorInfo.img.src = newUrl;
            }
        } catch (e) {
            console.log('[Mirror] MPM 刷新失败:', e.message);
        }
    }
    
    // 触发 mirror 恢复
    async triggerMirrorRecovery(mirrorInfo) {
        try {
            console.log('[Mirror] 触发模式恢复...');
            
            // 请求 /mirror 触发自动恢复
            const mirrorUrl = `${mirrorInfo.baseUrl}/mirror`;
            const response = await fetch(mirrorUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            
            if (response.status === 202) {
                console.log('[Mirror] 恢复请求已接受，等待 5 秒后检查状态...');
                // 等待 5 秒让模式启动
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // 重新检查状态
                const statusUrl = `${mirrorInfo.baseUrl}/mirror/status`;
                const statusResponse = await fetch(statusUrl, {
                    method: 'GET',
                    signal: AbortSignal.timeout(3000)
                });
                
                if (statusResponse.ok) {
                    const data = await statusResponse.json();
                    console.log(`[Mirror] 恢复后状态: mode=${data.currentMode}, active=${data.isActive}`);
                    
                    if (data.isActive) {
                        console.log('[Mirror] 模式恢复成功，重新加载画面');
                        // 重新加载图片
                        const newUrl = mirrorInfo.img.dataset.url + '?t=' + Date.now();
                        mirrorInfo.img.src = newUrl;
                    } else {
                        console.log('[Mirror] 模式恢复失败，将在下次检测时重试');
                    }
                }
            } else if (response.ok) {
                console.log('[Mirror] /mirror 请求成功，模式已恢复');
                // 重新加载图片
                const newUrl = mirrorInfo.img.dataset.url + '?t=' + Date.now();
                mirrorInfo.img.src = newUrl;
            }
        } catch (e) {
            console.log('[Mirror] 恢复请求失败:', e.message);
        }
    }

    // 启动 mirror 模式检查
    startMirrorModeCheck() {
        // 每 3 秒检查一次
        this.mirrorCheckInterval = setInterval(() => {
            this.checkAllMirrorModes();
        }, 3000);
    }

    // 检查所有 mirror 设备的模式
    async checkAllMirrorModes() {
        for (const [deviceId, mirrorInfo] of this.mirrorModes) {
            await this.checkMirrorMode(deviceId, mirrorInfo);
        }
    }

    // 检查单个 mirror 设备的模式
    async checkMirrorMode(deviceId, mirrorInfo) {
        try {
            const statusUrl = `${mirrorInfo.baseUrl}/mirror/status`;
            const response = await fetch(statusUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            if (!response.ok) return;
            
            const data = await response.json();
            const newMode = data.currentMode;
            const isActive = data.isActive;
            
            // 如果模式变化了，重新加载
            if (newMode !== mirrorInfo.currentMode) {
                console.log(`[Mirror] 模式变化: ${mirrorInfo.currentMode} -> ${newMode}`);
                mirrorInfo.currentMode = newMode;
                
                // 不显示状态提示，仅控制台日志
                
                // 重新加载图片（添加时间戳防止缓存）
                const newUrl = mirrorInfo.img.dataset.url + '?t=' + Date.now();
                mirrorInfo.img.src = newUrl;
            }
        } catch (e) {
            // 检查失败，可能是连接断开
            if (mirrorInfo.img.naturalWidth === 0) {
                // 图片加载失败，尝试重新加载
                const newUrl = mirrorInfo.img.dataset.url + '?t=' + Date.now();
                mirrorInfo.img.src = newUrl;
            }
        }
    }

    // ==================== 手势触摸层 ====================
    
    // 添加手势触摸层
    addGestureOverlay(deviceState, wrapper, img) {
        // 创建透明触摸层
        const overlay = document.createElement('div');
        overlay.className = 'gesture-overlay';
        overlay.dataset.gestureType = deviceState.gestureType;
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10;
            cursor: pointer;
            touch-action: none;
            background: transparent;
        `;
        
        // 存储触摸状态
        const touchState = {
            isPressed: false,
            startX: 0,
            startY: 0,
            startTime: 0,
            lastX: 0,
            lastY: 0,
            pointerId: 0
        };
        
        // 设备屏幕尺寸（用于坐标转换）
        const deviceSize = { width: 720, height: 1600 };
        
        // 计算坐标：相对百分比 * 设备尺寸，保留一位小数
        const getCoords = (e) => {
            const rect = overlay.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;
            const pixelX = relX * deviceSize.width;
            const pixelY = relY * deviceSize.height;
            return {
                value: { x: pixelX, y: pixelY },  // 数字类型，用于计算
                string: { x: pixelX.toFixed(1), y: pixelY.toFixed(1) }  // 字符串类型，用于发送
            };
        };
        
        // 统一的手势发送函数（HID 和 无障碍都使用相同的坐标值）
        const sendGestureCommand = (gestureType, data) => {
            if (deviceState.gestureType === this.GESTURE_TYPES.ACC) {
                // 无障碍手势 - 通过 WebSocket
                this.sendAccGesture(deviceState.id, gestureType, data);
            } else {
                // HID 手势 - 通过 HTTP
                this.sendHidGesture(deviceState, gestureType, data);
            }
        };
        
        // 根据手势类型选择处理方式
        const isAccGesture = deviceState.gestureType === this.GESTURE_TYPES.ACC;
        
        if (isAccGesture) {
            // ========== 无障碍手势：实时流式 POINTER_DOWN/MOVE/UP ==========
            
            // 鼠标/触摸按下
            overlay.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const coords = getCoords(e);
                touchState.isPressed = true;
                touchState.startX = coords.value.x;
                touchState.startY = coords.value.y;
                touchState.lastX = coords.value.x;
                touchState.lastY = coords.value.y;
                touchState.startTime = Date.now();
                
                console.log('[Gesture] 发送 POINTER_DOWN:', coords.string.x, coords.string.y);
                this.sendAccGesture(deviceState.id, 'POINTER_DOWN', {
                    x: coords.string.x,
                    y: coords.string.y,
                    pressure: 1.0
                });
            });
            
            // 鼠标/触摸移动
            overlay.addEventListener('mousemove', (e) => {
                if (!touchState.isPressed) return;
                e.preventDefault();
                const coords = getCoords(e);
                
                const distance = Math.sqrt(
                    Math.pow(coords.value.x - touchState.lastX, 2) + 
                    Math.pow(coords.value.y - touchState.lastY, 2)
                );
                
                if (distance > 5) {
                    this.sendAccGesture(deviceState.id, 'POINTER_MOVE', {
                        x: coords.string.x,
                        y: coords.string.y,
                        pressure: 1.0
                    });
                    
                    touchState.lastX = coords.value.x;
                    touchState.lastY = coords.value.y;
                }
            });
            
            // 鼠标/触摸抬起
            overlay.addEventListener('mouseup', (e) => {
                if (!touchState.isPressed) return;
                e.preventDefault();
                const coords = getCoords(e);
                
                console.log('[Gesture] 发送 POINTER_UP:', coords.string.x, coords.string.y);
                this.sendAccGesture(deviceState.id, 'POINTER_UP', {
                    x: coords.string.x,
                    y: coords.string.y
                });
                
                touchState.isPressed = false;
            });
            
            // 鼠标离开
            overlay.addEventListener('mouseleave', (e) => {
                if (touchState.isPressed) {
                    const coords = getCoords(e);
                    this.sendAccGesture(deviceState.id, 'POINTER_UP', {
                        x: coords.string.x,
                        y: coords.string.y
                    });
                    touchState.isPressed = false;
                }
            });
            
            // 触摸事件
            overlay.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const touch = e.touches[0];
                const coords = getCoords(touch);
                touchState.isPressed = true;
                touchState.startX = coords.value.x;
                touchState.startY = coords.value.y;
                touchState.lastX = coords.value.x;
                touchState.lastY = coords.value.y;
                touchState.startTime = Date.now();
                
                this.sendAccGesture(deviceState.id, 'POINTER_DOWN', {
                    x: coords.string.x,
                    y: coords.string.y,
                    pressure: 1.0
                });
            }, { passive: false });
            
            overlay.addEventListener('touchmove', (e) => {
                if (!touchState.isPressed) return;
                e.preventDefault();
                const touch = e.touches[0];
                const coords = getCoords(touch);
                
                const distance = Math.sqrt(
                    Math.pow(coords.value.x - touchState.lastX, 2) + 
                    Math.pow(coords.value.y - touchState.lastY, 2)
                );
                
                if (distance > 5) {
                    this.sendAccGesture(deviceState.id, 'POINTER_MOVE', {
                        x: coords.string.x,
                        y: coords.string.y,
                        pressure: 1.0
                    });
                    
                    touchState.lastX = coords.value.x;
                    touchState.lastY = coords.value.y;
                }
            }, { passive: false });
            
            overlay.addEventListener('touchend', (e) => {
                if (!touchState.isPressed) return;
                e.preventDefault();
                
                const lastXStr = touchState.lastX.toFixed(1);
                const lastYStr = touchState.lastY.toFixed(1);
                
                this.sendAccGesture(deviceState.id, 'POINTER_UP', {
                    x: lastXStr,
                    y: lastYStr
                });
                
                touchState.isPressed = false;
            });
            
        } else {
            // ========== HID 手势：批量命令模式 ==========
            
            const MIN_MOVE_DISTANCE = 3;  // 最小移动距离3像素（减少发送频率）
            const MOVE_THROTTLE = 16;     // 移动命令最小间隔16ms（约60Hz，给固件处理时间）
            
            let lastX = 0, lastY = 0;
            let lastMoveTime = 0;
            let isPressed = false;
            
            // 直接发送命令（实时模式，无缓冲）
            const sendCmd = (cmd) => {
                const ws = this.gestureWebSockets?.get(deviceState.id);
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    console.error('[Gesture] WebSocket not connected');
                    return;
                }
                
                const message = JSON.stringify({
                    type: 'hid_command',
                    command: cmd,
                    timestamp: Date.now()
                });
                
                try {
                    ws.send(message);
                    if (cmd.startsWith('mv:')) {
                        // 移动命令不打印，避免日志过多
                    } else {
                        console.log('[Gesture] Sent:', cmd);
                    }
                } catch (e) {
                    console.error('[Gesture] Failed to send:', cmd, e);
                }
            };
            
            // 发送 up 命令（重复三次确保抬起成功）
            const sendUp = () => {
                sendCmd('up:');
                // 5ms 后第二次发送
                setTimeout(() => sendCmd('up:'), 5);
                // 12ms 后第三次发送
                setTimeout(() => sendCmd('up:'), 12);
                // 18ms 后第四次发送
                setTimeout(() => sendCmd('up:'), 18);
                // 24ms 后第五次发送
                setTimeout(() => sendCmd('up:'), 24);
            };
            
            // 鼠标/触摸按下
            overlay.addEventListener('mousedown', (e) => {
                e.preventDefault();
                
                const coords = getCoords(e);
                isPressed = true;
                touchState.isPressed = true;
                touchState.startX = coords.value.x;
                touchState.startY = coords.value.y;
                touchState.lastX = coords.value.x;
                touchState.lastY = coords.value.y;
                touchState.startTime = Date.now();
                
                const x = Math.round(parseFloat(coords.string.x));
                const y = Math.round(parseFloat(coords.string.y));
                lastX = x;
                lastY = y;
                lastMoveTime = Date.now();
                
                console.log('[Gesture] HID 按下:', x, y);
                sendCmd(`dn:${x},${y}`);
            });
            
            // 鼠标/触摸移动
            overlay.addEventListener('mousemove', (e) => {
                if (!isPressed) return;
                e.preventDefault();
                
                const now = Date.now();
                // 节流：8ms内不重复发送
                if (now - lastMoveTime < MOVE_THROTTLE) return;
                
                const coords = getCoords(e);
                const x = Math.round(parseFloat(coords.string.x));
                const y = Math.round(parseFloat(coords.string.y));
                
                // 检查距离阈值
                const dist = Math.sqrt((x - lastX) ** 2 + (y - lastY) ** 2);
                if (dist < MIN_MOVE_DISTANCE) return;
                
                lastX = x;
                lastY = y;
                lastMoveTime = now;
                
                sendCmd(`mv:${x},${y}`);
                touchState.lastX = coords.value.x;
                touchState.lastY = coords.value.y;
            });
            
            // 鼠标/触摸抬起
            overlay.addEventListener('mouseup', (e) => {
                if (!isPressed) return;
                e.preventDefault();
                
                console.log('[Gesture] HID 抬起');
                isPressed = false;
                touchState.isPressed = false;
                sendUp();
            });
            
            // 鼠标离开
            overlay.addEventListener('mouseleave', (e) => {
                if (isPressed) {
                    console.log('[Gesture] HID 离开');
                    isPressed = false;
                    touchState.isPressed = false;
                    sendUp();
                }
            });
            
            // 触摸事件
            overlay.addEventListener('touchstart', (e) => {
                e.preventDefault();
                
                const touch = e.touches[0];
                const coords = getCoords(touch);
                isPressed = true;
                touchState.isPressed = true;
                touchState.startX = coords.value.x;
                touchState.startY = coords.value.y;
                touchState.lastX = coords.value.x;
                touchState.lastY = coords.value.y;
                touchState.startTime = Date.now();
                
                const x = Math.round(parseFloat(coords.string.x));
                const y = Math.round(parseFloat(coords.string.y));
                lastX = x;
                lastY = y;
                lastMoveTime = Date.now();
                
                console.log('[Gesture] HID 按下:', x, y);
                sendCmd(`dn:${x},${y}`);
            }, { passive: false });
            
            overlay.addEventListener('touchmove', (e) => {
                if (!isPressed) return;
                e.preventDefault();
                
                const now = Date.now();
                // 节流：8ms内不重复发送
                if (now - lastMoveTime < MOVE_THROTTLE) return;
                
                const touch = e.touches[0];
                const coords = getCoords(touch);
                const x = Math.round(parseFloat(coords.string.x));
                const y = Math.round(parseFloat(coords.string.y));
                
                // 检查距离阈值
                const dist = Math.sqrt((x - lastX) ** 2 + (y - lastY) ** 2);
                if (dist < MIN_MOVE_DISTANCE) return;
                
                lastX = x;
                lastY = y;
                lastMoveTime = now;
                
                sendCmd(`mv:${x},${y}`);
                touchState.lastX = coords.value.x;
                touchState.lastY = coords.value.y;
            }, { passive: false });
            
            overlay.addEventListener('touchend', (e) => {
                if (!isPressed) return;
                e.preventDefault();
                
                console.log('[Gesture] HID 抬起');
                isPressed = false;
                touchState.isPressed = false;
                sendUp();
            });
        }
        
        // 添加到 wrapper
        wrapper.appendChild(overlay);
        console.log('[Gesture] 手势触摸层已添加:', deviceState.id, '类型:', deviceState.gestureType);
    }
    
    // 初始化手势连接
    initGestureConnection(deviceState) {
        // 无论无障碍还是 HID 手势，都建立 WebSocket 连接
        // HID 手势通过 WebSocket 发送命令到手机，手机再转发给蓝牙 HID 开发板
        const wsUrl = this.getWebSocketUrl(deviceState.url);
        this.connectGestureWebSocket(deviceState.id, wsUrl);
        console.log('[Gesture] WebSocket 连接已建立:', deviceState.id, '类型:', deviceState.gestureType);
    }
    
    // 发送无障碍手势
    sendAccGesture(deviceId, gestureType, data) {
        if (!this.gestureWebSockets) {
            console.warn('[Gesture] gestureWebSockets 未初始化');
            return;
        }
        const ws = this.gestureWebSockets.get(deviceId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            const command = {
                type: 'gesture',
                gestureType: gestureType,
                ...data,
                timestamp: Date.now()
            };
            console.log('[Gesture] 发送无障碍命令:', deviceId, gestureType, data);
            ws.send(JSON.stringify(command));
        } else {
            console.warn('[Gesture] WebSocket 未连接:', deviceId, '状态:', ws ? ws.readyState : 'null');
        }
    }
    
    // 发送 HID 手势 - 现在通过 WebSocket 发送
    async sendHidGesture(deviceState, gestureType, data) {
        // data.x 和 data.y 是字符串（保留一位小数），HID 需要整数
        const x = Math.round(parseFloat(data.x));
        const y = Math.round(parseFloat(data.y));
        
        let command = '';
        switch(gestureType) {
            case 'TAP':
                command = `cl:${x},${y},100`;
                break;
            case 'LONG_PRESS':
                command = `cl:${x},${y},${data.duration || 500}`;
                break;
            case 'SWIPE':
                const endX = Math.round(parseFloat(data.endX || data.x));
                const endY = Math.round(parseFloat(data.endY || data.y));
                command = `swipe:${x},${y},${endX},${endY},${data.duration || 300}`;
                break;
            default:
                // POINTER_DOWN/MOVE/UP 在 HID 中不处理
                return;
        }
        
        if (command) {
            console.log('[Gesture] HID 命令:', command);
            this.sendHidCommandViaWebSocket(deviceState.id, command);
        }
    }
    
    // 切换手势类型
    switchGestureType(deviceId, newType) {
        const deviceState = this.devices.get(deviceId);
        if (!deviceState) return;
        
        const oldType = deviceState.gestureType;
        if (oldType === newType) return;
        
        console.log('[Gesture] 切换手势类型:', deviceId, oldType, '->', newType);
        
        // 断开旧连接
        if (oldType === this.GESTURE_TYPES.ACC) {
            this.disconnectGestureWebSocket(deviceId);
        }
        
        // 更新类型
        deviceState.gestureType = newType;
        
        // 初始化新手势连接
        console.log('[Gesture] 初始化新手势连接:', deviceId, '类型:', newType);
        this.initGestureConnection(deviceState);
        
        // 更新 UI - 重新创建手势层
        const wrapper = document.querySelector(`.video-feed-wrapper:has([data-id="${deviceId}"])`);
        if (wrapper) {
            // 移除旧的手势层
            const oldOverlay = wrapper.querySelector('.gesture-overlay');
            if (oldOverlay) {
                oldOverlay.remove();
            }
            
            // 更新切换按钮
            const switcher = wrapper.querySelector('.gesture-switcher');
            if (switcher) {
                switcher.textContent = newType === this.GESTURE_TYPES.ACC ? '♿' : '🔵';
                switcher.title = newType === this.GESTURE_TYPES.ACC ? '无障碍手势' : 'HID 手势';
            }
            
            // 重新创建手势层
            const img = wrapper.querySelector('.video-feed');
            if (img) {
                this.addGestureOverlay(deviceState, wrapper, img);
            }
        }
        
        // 保存配置
        this.saveConfigs();
    }
    
    // 添加手势类型切换按钮
    addGestureTypeSwitcher(deviceState, wrapper) {
        const switcher = document.createElement('button');
        switcher.className = 'gesture-switcher';
        const isAcc = deviceState.gestureType === this.GESTURE_TYPES.ACC;
        switcher.textContent = isAcc ? '♿' : '🔵';
        switcher.title = isAcc ? '无障碍手势 (点击切换)' : 'HID 手势 (点击切换)';
        switcher.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            z-index: 20;
            width: 32px;
            height: 32px;
            border: none;
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.6);
            color: white;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        `;
        
        switcher.addEventListener('mouseenter', () => {
            switcher.style.background = 'rgba(0, 0, 0, 0.8)';
            switcher.style.transform = 'scale(1.1)';
        });
        
        switcher.addEventListener('mouseleave', () => {
            switcher.style.background = 'rgba(0, 0, 0, 0.6)';
            switcher.style.transform = 'scale(1)';
        });
        
        switcher.addEventListener('click', (e) => {
            e.stopPropagation(); // 防止触发手势层
            const newType = deviceState.gestureType === this.GESTURE_TYPES.ACC 
                ? this.GESTURE_TYPES.HID 
                : this.GESTURE_TYPES.ACC;
            this.switchGestureType(deviceState.id, newType);
        });
        
        wrapper.appendChild(switcher);
        console.log('[Gesture] 手势切换按钮已添加:', deviceState.id);
    }
    
    // 获取 WebSocket URL
    getWebSocketUrl(deviceUrl) {
        try {
            const url = new URL(deviceUrl);
            // WebSocket 服务运行在 8889 端口
            return `ws://${url.hostname}:8889/ws`;
        } catch (e) {
            console.error('[Gesture] 解析 URL 失败:', deviceUrl, e);
            return null;
        }
    }
    
    // 连接手势 WebSocket
    connectGestureWebSocket(deviceId, wsUrl) {
        if (!wsUrl) {
            console.error('[Gesture] WebSocket URL 为空');
            return;
        }
        
        console.log('[Gesture] 正在连接 WebSocket:', deviceId, wsUrl);
        
        // 关闭已有连接和心跳
        const existingWs = this.gestureWebSockets.get(deviceId);
        if (existingWs) {
            console.log('[Gesture] 关闭已有 WebSocket 连接:', deviceId);
            existingWs.close();
        }
        if (this.heartbeatIntervals && this.heartbeatIntervals.has(deviceId)) {
            clearInterval(this.heartbeatIntervals.get(deviceId));
            this.heartbeatIntervals.delete(deviceId);
        }
        
        try {
            const ws = new WebSocket(wsUrl);
            let heartbeatInterval = null;
            
            ws.onopen = () => {
                console.log('[Gesture] WebSocket 连接成功:', deviceId);
                // 存储 WebSocket 连接
                if (!this.gestureWebSockets) {
                    this.gestureWebSockets = new Map();
                }
                this.gestureWebSockets.set(deviceId, ws);
                console.log('[Gesture] WebSocket 已存储:', deviceId, '当前连接数:', this.gestureWebSockets.size);
                // 发送配置信息
                // 使用固定的设备尺寸 720x1600（与坐标计算时使用的基准一致）
                ws.send(JSON.stringify({
                    type: 'gesture_config',
                    screenWidth: 720,
                    screenHeight: 1600,
                    mirrorWidth: 288,
                    mirrorHeight: 640
                }));
                
                // 启动心跳 - 每 3 秒发送一次 ping（防止超时）
                heartbeatInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                        //console.log('[Gesture] 心跳:', deviceId);
                    }
                }, 3000);
                
                if (!this.heartbeatIntervals) {
                    this.heartbeatIntervals = new Map();
                }
                this.heartbeatIntervals.set(deviceId, heartbeatInterval);
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('[Gesture] 收到响应:', data);
                    
                    // 处理 pong 响应
                    if (data.type === 'pong') {
                        //console.log('[Gesture] 收到心跳响应:', deviceId);
                    }
                    
                    // 处理连接响应，检查 HID 状态
                    if (data.type === 'connected') {
                        if (data.serviceStatus === 'acc_ready_hid_init' || data.serviceStatus === 'not_ready') {
                            console.log('[Gesture] HID 未就绪，等待 2 秒后重试...');
                            // 延迟发送配置，给 HID 更多时间初始化
                            setTimeout(() => {
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: 'gesture_config',
                                        screenWidth: 720,
                                        screenHeight: 1600,
                                        mirrorWidth: 288,
                                        mirrorHeight: 640
                                    }));
                                    console.log('[Gesture] 延迟发送配置完成');
                                }
                            }, 2000);
                        }
                    }
                } catch (e) {
                    console.log('[Gesture] 收到消息:', event.data);
                }
            };
            
            ws.onerror = (error) => {
                console.error('[Gesture] WebSocket 错误:', deviceId, error);
            };
            
            ws.onclose = () => {
                console.log('[Gesture] WebSocket 关闭:', deviceId);
                // 清除心跳
                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                }
                if (this.heartbeatIntervals && this.heartbeatIntervals.has(deviceId)) {
                    this.heartbeatIntervals.delete(deviceId);
                }
                this.gestureWebSockets.delete(deviceId);
                // 3秒后重连
                setTimeout(() => {
                    this.connectGestureWebSocket(deviceId, wsUrl);
                }, 3000);
            };
            
            // 立即存储 WebSocket（连接中状态）
            if (!this.gestureWebSockets) {
                this.gestureWebSockets = new Map();
            }
            this.gestureWebSockets.set(deviceId, ws);
            console.log('[Gesture] WebSocket 创建并存储:', deviceId, '状态:', ws.readyState);
        } catch (e) {
            console.error('[Gesture] WebSocket 连接失败:', deviceId, e);
        }
    }
    
    // 断开手势 WebSocket
    disconnectGestureWebSocket(deviceId) {
        const ws = this.gestureWebSockets.get(deviceId);
        if (ws) {
            ws.close();
            this.gestureWebSockets.delete(deviceId);
            console.log('[Gesture] WebSocket 已断开:', deviceId);
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('[调试] 页面加载完成, 初始化管理器');
    new IframeManager();
});
