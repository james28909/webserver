document.addEventListener('DOMContentLoaded', () => {
    // Initialize player with error handling
    const player = new Plyr('#player', {
        controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
        loadSprite: false
    });

    // Add player error handling
    player.on('error', (error) => {
        console.error('Plyr error:', error);
    });

    // Add player ready handling
    player.on('ready', () => {
        console.log('Player is ready');
    });

    // Add player progress handling
    player.on('progress', (event) => {
        console.log('Loading progress:', event);
    });

    const searchInput = document.getElementById('search-input');
    const videoGrid = document.getElementById('video-grid');
    const playerContainer = document.getElementById('player-container');
    const closePlayer = document.getElementById('close-player');
    const navButtons = document.querySelectorAll('.nav-btn');

    // Close player
    closePlayer.addEventListener('click', () => {
        playerContainer.classList.add('hidden');
        player.stop();
    });

    function showLoading() {
        videoGrid.innerHTML = '<div class="text-gray-600 dark:text-gray-300">Loading...</div>';
    }

    // Search handling
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            showLoading();
            searchVideos(e.target.value);
        }, 500);
    });

    async function searchVideos(query = '') {
        try {
            const response = await fetch(`${CONFIG.API_URL}/api/videos?search=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Network response was not ok');
            const videos = await response.json();
            displayVideos(videos);
        } catch (error) {
            console.error('Error fetching videos:', error);
            videoGrid.innerHTML = '<div class="text-red-500">Error loading videos</div>';
        }
    }

    async function loadSubscriptions() {
        try {
            const response = await fetch(`${CONFIG.API_URL}/api/subscriptions`);
            if (!response.ok) throw new Error('Network response was not ok');
            const videos = await response.json();

            if (!Array.isArray(videos)) {
                throw new Error('Invalid data format received from server');
            }

            displayVideos(videos);
        } catch (error) {
            console.error('Error fetching subscriptions:', error);
            videoGrid.innerHTML = '<div class="text-red-500">Error loading subscriptions</div>';
        }
    }

    async function loadLibraries() {
        try {
            const response = await fetch(`${CONFIG.API_URL}/api/libraries`);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format');
            }

            videoGrid.innerHTML = data.map(playlist => `
                <div class="video-thumbnail" data-playlist-id="${playlist.id}">
                    <img src="${playlist.snippet.thumbnails.medium.url}" 
                         alt="${playlist.snippet.title}"
                         onerror="this.onerror=null; this.src='/img/no_thumbnail.jpg';">
                    <div class="video-title">${playlist.snippet.title}</div>
                </div>
            `).join('');

            attachPlaylistClickHandlers();
        } catch (error) {
            console.error('Error fetching libraries:', error);
            videoGrid.innerHTML = '<div class="text-red-500">Error loading playlists</div>';
        }
    }

    async function loadLocalVideos() {
        try {
            showLoading();
            const response = await fetch(`${CONFIG.API_URL}/api/local`);
            if (!response.ok) throw new Error('Network response was not ok');
            const videos = await response.json();
            
            if (!videos || videos.length === 0) {
                videoGrid.innerHTML = '<div class="text-gray-600 dark:text-gray-300">No downloaded videos found</div>';
                return;
            }
            
            displayVideos(videos);
        } catch (error) {
            console.error('Error fetching local videos:', error);
            videoGrid.innerHTML = '<div class="text-red-500">Error loading local videos</div>';
        }
    }

    function attachPlaylistClickHandlers() {
        document.querySelectorAll('[data-playlist-id]').forEach(thumb => {
            thumb.addEventListener('click', () => {
                const playlistId = thumb.dataset.playlistId;
                if (playlistId) {
                    loadPlaylistVideos(playlistId);
                }
            });
        });
    }

    async function loadPlaylistVideos(playlistId) {
        try {
            const response = await fetch(`${CONFIG.API_URL}/api/playlist/${playlistId}`);
            if (!response.ok) throw new Error('Network response was not ok');
            const videos = await response.json();
            displayVideos(videos);
        } catch (error) {
            console.error('Error fetching playlist videos:', error);
            videoGrid.innerHTML = '<div class="text-red-500">Error loading playlist videos</div>';
        }
    }

    // Video play function
    async function playVideo(videoId, title) {
        try {
            playerContainer.classList.remove('hidden');
            
            // Reset player before loading new source
            player.stop();
            
            player.source = {
                type: 'video',
                title: title,
                sources: [{
                    src: `${CONFIG.API_URL}/api/download/${videoId}`,
                    type: 'video/mp4',
                }]
            };

            // Force player to load and play
            await player.play().catch(error => {
                console.error('Play error:', error);
            });

        } catch (error) {
            console.error('Error playing video:', error);
            alert('Error playing video. Please try again.');
        }
    }

    function displayVideos(videos) {
        if (!Array.isArray(videos)) {
            console.error('Videos is not an array:', videos);
            videoGrid.innerHTML = '<div class="text-red-500">Error displaying videos</div>';
            return;
        }

        videoGrid.innerHTML = videos.map(video => `
            <div class="video-thumbnail" data-video-id="${video.id?.videoId || video.id}">
                <img src="${video.snippet.thumbnails?.medium?.url || '/img/no_thumbnail.jpg'}" 
                     alt="${video.snippet.title}"
                     onerror="this.onerror=null; this.src='/img/no_thumbnail.jpg';">
                <div class="video-title">${video.snippet.title}</div>
            </div>
        `).join('');

        attachVideoClickHandlers();
    }

    function attachVideoClickHandlers() {
        document.querySelectorAll('[data-video-id]').forEach(thumb => {
            thumb.addEventListener('click', async () => {
                const videoId = thumb.dataset.videoId;
                const title = thumb.querySelector('.video-title').textContent;
                
                if (!videoId) {
                    console.error('No video ID found');
                    return;
                }
                
                await playVideo(videoId, title);
            });
        });
    }

    // Navigation handling
    navButtons.forEach(button => {
        const handleNavigation = async (e) => {
            e.preventDefault();
            
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            const page = button.dataset.page;
            showLoading();
            
            switch(page) {
                case 'subscriptions':
                    await loadSubscriptions();
                    break;
                case 'libraries':
                    await loadLibraries();
                    break;
                case 'local':
                    await loadLocalVideos();
                    break;
                case 'home':
                default:
                    await searchVideos();
                    break;
            }

            history.pushState({}, '', `/${page === 'home' ? '' : page}`);
        };

        button.addEventListener('click', handleNavigation);
        button.addEventListener('touchend', handleNavigation, { passive: false });
    });

    // Initial load with loading state
    showLoading();
    searchVideos().catch(error => {
        console.error('Initial load error:', error);
        videoGrid.innerHTML = '<div class="text-red-500">Error loading initial videos</div>';
    });
});