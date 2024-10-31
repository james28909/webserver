require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const fs = require('fs');
const fsPromises = fs.promises;
const cors = require('cors');
const youtubeDl = require('youtube-dl-exec');
const { PassThrough } = require('stream');
const https = require('https');

const app = express();
const port = 8080;
const cookiePath = path.join(__dirname, 'www.youtube.com_cookies.txt');

// Buffer settings
const INITIAL_BUFFER_THRESHOLD = 2 * 1024 * 1024; // 2MB
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;         // 10MB
const CHUNK_SIZE = 16 * 1024;                     // 16KB
const WRITE_THRESHOLD = 1024 * 1024;              // 1MB

// Add these near the top of the file, after the constants
let videosCache = {
    data: null,
    lastUpdated: null
};

// After the videosCache object, add subscriptionsCache
let subscriptionsCache = {
    data: null,
    lastUpdated: null
};

// Add this constant after other constants
const CACHE_VALIDITY_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds

// Add CORS and other middleware
app.use(cors({
    origin: [
        'http://localhost:8080',
        'https://web.my-hass.pro',
        'http://web.my-hass.pro'
    ],
    credentials: true
}));
app.use(express.json());

// Add cache control headers
app.use((req, res, next) => {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    next();
});

// Initialize YouTube API
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// Serve static files
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

// Serve default thumbnail
app.get('/img/no_thumbnail.jpg', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'img', 'no_thumbnail.jpg'));
});

// Client-side routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/subscriptions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/libraries', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/local', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add this function before the routes
async function updateVideosCache() {
    try {
        const result = await youtubeDl('https://www.youtube.com/', {
            cookies: cookiePath,
            flatPlaylist: true,
            dumpSingleJson: true
        });

        if (!result.entries || !Array.isArray(result.entries)) {
            throw new Error('No entries found');
        }

        const videos = result.entries.map(entry => ({
            id: { videoId: entry.id },
            snippet: {
                title: entry.title,
                thumbnails: {
                    medium: { url: entry.thumbnails?.[0]?.url || entry.thumbnail || '/img/no_thumbnail.jpg' }
                }
            }
        }));

        videosCache.data = videos;
        videosCache.lastUpdated = new Date();
        console.log('Videos cache updated at:', videosCache.lastUpdated);
    } catch (error) {
        console.error('Cache update error:', error);
    }
}

// Modify updateSubscriptionsCache function
async function updateSubscriptionsCache() {
    try {
        const result = await youtubeDl('https://www.youtube.com/feed/subscriptions', {
            cookies: cookiePath,
            dumpSingleJson: true,
            flatPlaylist: true,      // Fetch a flat list of videos
            playlistEnd: 100,         // Limit to the first 20 videos
            skipDownload: true,      // Do not download video data
            simulate: true,          // Do not download video files
            noCheckCertificate: true, // Bypass certificate checks
            noWarnings: true,        // Suppress warnings
            preferFreeFormats: true, // Prefer free formats
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            ],
        });

        if (!result.entries || !Array.isArray(result.entries)) {
            throw new Error('No entries found in subscriptions feed');
        }

        // Extract thumbnails and other data
        const videos = result.entries.map(entry => ({
            id: { videoId: entry.id },
            snippet: {
                title: entry.title,
                thumbnails: {
                    medium: {
                        url: entry.thumbnails?.[0]?.url || entry.thumbnail || '/img/no_thumbnail.jpg'
                    }
                }
            }
        }));

        subscriptionsCache.data = videos;
        subscriptionsCache.lastUpdated = new Date();
        console.log('Subscriptions cache updated at:', subscriptionsCache.lastUpdated);
    } catch (error) {
        console.error('Subscriptions cache update error:', error);
    }
}

// Add this function after the cache objects
function isCacheValid(cache) {
    return cache.data && 
           cache.lastUpdated && 
           (Date.now() - cache.lastUpdated) < CACHE_VALIDITY_DURATION;
}

// Add this function after other helper functions
async function downloadThumbnail(videoId, videoTitle) {
    try {
        const videoResponse = await youtube.videos.list({
            part: 'snippet',
            id: videoId
        });

        if (!videoResponse.data.items?.[0]?.snippet?.thumbnails?.medium?.url) {
            throw new Error('No thumbnail URL found');
        }

        const thumbnailUrl = videoResponse.data.items[0].snippet.thumbnails.medium.url;
        const thumbnailPath = path.join(__dirname, 'public', 'img', `${videoTitle}.jpg`);

        return new Promise((resolve, reject) => {
            https.get(thumbnailUrl, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download thumbnail: ${response.statusCode}`));
                    return;
                }

                const fileStream = fs.createWriteStream(thumbnailPath);
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve(thumbnailPath);
                });

                fileStream.on('error', reject);
            }).on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading thumbnail:', error);
        return null;
    }
}

// Add this helper function after other helper functions
async function getAllPlaylistItems(playlistId) {
    let allItems = [];
    let nextPageToken = null;
    
    do {
        try {
            const response = await youtube.playlistItems.list({
                part: 'snippet',
                playlistId: playlistId,
                maxResults: 50,
                pageToken: nextPageToken
            });

            if (response.data.items) {
                const videos = response.data.items.map(item => ({
                    id: { videoId: item.snippet.resourceId.videoId },
                    snippet: {
                        title: item.snippet.title,
                        thumbnails: {
                            medium: item.snippet.thumbnails?.medium || 
                                    item.snippet.thumbnails?.default || 
                                    { url: '/img/no_thumbnail.jpg' }
                        }
                    }
                }));
                
                allItems = allItems.concat(videos);
            }

            nextPageToken = response.data.nextPageToken;
        } catch (error) {
            console.error('Error fetching playlist page:', error);
            break;
        }
    } while (nextPageToken);

    return allItems;
}

// API endpoints
// Replace the /api/videos endpoint
app.get('/api/videos', async (req, res) => {
    const searchQuery = req.query.search;
    
    // If it's not a search and cache is valid, return cached data
    if (!searchQuery && isCacheValid(videosCache)) {
        console.log('Serving videos from cache');
        return res.json(videosCache.data);
    }

    try {
        if (!searchQuery && !videosCache.data) {
            // Update cache for non-search requests if cache is empty
            await updateVideosCache();
            if (videosCache.data) {
                return res.json(videosCache.data);
            }
        } else if (searchQuery) {
            // Handle search queries directly without caching
            const result = await youtubeDl(`ytsearch20:${searchQuery}`, {
                cookies: cookiePath,
                flatPlaylist: true,
                dumpSingleJson: true
            });

            if (!result.entries || !Array.isArray(result.entries)) {
                throw new Error('No entries found');
            }

            const videos = result.entries.map(entry => ({
                id: { videoId: entry.id },
                snippet: {
                    title: entry.title,
                    thumbnails: {
                        medium: { url: entry.thumbnails?.[0]?.url || entry.thumbnail || '/img/no_thumbnail.jpg' }
                    }
                }
            }));

            return res.json(videos);
        }

        res.status(500).json({ error: 'Failed to fetch video data' });
    } catch (error) {
        console.error('Parse error:', error);
        res.status(500).json({ error: 'Failed to parse video data' });
    }
});

// Replace the /api/subscriptions endpoint
app.get('/api/subscriptions', async (req, res) => {
    // If cache is valid, return cached data
    if (isCacheValid(subscriptionsCache)) {
        console.log('Serving subscriptions from cache');
        return res.json(subscriptionsCache.data);
    }

    try {
        // Update cache
        await updateSubscriptionsCache();
        
        if (subscriptionsCache.data) {
            res.json(subscriptionsCache.data);
        } else {
            res.status(500).json({ error: 'Failed to fetch subscriptions data' });
        }
    } catch (error) {
        console.error('Error fetching subscriptions:', error);
        // If cache exists but is stale, return it as fallback
        if (subscriptionsCache.data) {
            console.log('Serving stale subscriptions cache as fallback');
            return res.json(subscriptionsCache.data);
        }
        res.status(500).json({ error: 'Failed to fetch subscriptions data' });
    }
});

app.get('/api/libraries', async (req, res) => {
    try {
        const response = await youtube.playlists.list({
            part: 'snippet',
            channelId: process.env.YOUTUBE_CHANNEL_ID,
            maxResults: 50
        });

        if (!response.data.items) {
            console.error('No playlists found');
            res.status(404).json({ error: 'No playlists found' });
            return;
        }

        const playlists = response.data.items.map(playlist => ({
            id: playlist.id,
            snippet: {
                title: playlist.snippet.title,
                thumbnails: {
                    medium: playlist.snippet.thumbnails?.medium || 
                            playlist.snippet.thumbnails?.default || 
                            { url: '/img/no_thumbnail.jpg' }
                }
            }
        }));

        res.json(playlists);
    } catch (error) {
        console.error('YouTube API error:', error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});

// Replace the playlist endpoint with this version
app.get('/api/playlist/:playlistId', async (req, res) => {
    try {
        const videos = await getAllPlaylistItems(req.params.playlistId);
        
        if (!videos.length) {
            return res.status(404).json({ error: 'No videos found in playlist' });
        }

        res.json(videos);
    } catch (error) {
        console.error('YouTube API error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch playlist videos' });
    }
});

// Replace the /api/local endpoint
app.get('/api/local', async (req, res) => {
    try {
        const downloadsPath = path.join(__dirname, 'downloads');
        const files = await fsPromises.readdir(downloadsPath);
        
        const videos = files
            .filter(file => file.endsWith('.mp4'))
            .map(file => {
                const title = file.replace('.mp4', '');
                const thumbnailPath = `/img/${title}.jpg`;
                const fallbackThumbnail = `/downloads/${encodeURIComponent(file)}#t=0.1`;

                return {
                    id: { videoId: encodeURIComponent(file) },
                    snippet: {
                        title: title,
                        thumbnails: {
                            medium: { 
                                url: fs.existsSync(path.join(__dirname, 'public', thumbnailPath)) 
                                    ? thumbnailPath 
                                    : fallbackThumbnail
                            }
                        }
                    }
                };
            });

        res.json(videos);
    } catch (error) {
        console.error('Error reading local videos:', error);
        res.status(500).json({ error: 'Failed to read local videos' });
    }
});

// Modify the /api/download/:videoId endpoint - update the beginning of the try block
app.get('/api/download/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    
    try {
        // Get video details from YouTube API
        const videoResponse = await youtube.videos.list({
            part: 'snippet',
            id: videoId
        });

        if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
            throw new Error('Video not found');
        }

        let videoTitle = videoResponse.data.items[0].snippet.title;
        videoTitle = videoTitle.replace(/[<>:"/\\|?*]/g, '').trim();
        videoTitle = videoTitle.substring(0, 200);

        // Download thumbnail before starting video download
        await downloadThumbnail(videoId, videoTitle);

        const downloadPath = path.join(__dirname, 'downloads', `${videoTitle}.mp4`);

        // If file exists, stream it directly
        if (fs.existsSync(downloadPath)) {
            const stat = fs.statSync(downloadPath);
            res.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Content-Length': stat.size,
                'Accept-Ranges': 'bytes'
            });
            fs.createReadStream(downloadPath).pipe(res);
            return;
        }

        // Set headers for streaming
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Transfer-Encoding': 'chunked'
        });

        // Create a pass-through stream for immediate streaming
        const passThrough = new PassThrough();
        passThrough.pipe(res);

        let isStreamEnded = false;
        let fileStream = null;

        // Start download using youtube-dl-exec
        const downloadProcess = youtubeDl.exec(
            `https://www.youtube.com/watch?v=${videoId}`,
            {
                cookies: cookiePath,
                format: 'best[ext=mp4]/best', // Simplified format string
                output: '-',  // Output to stdout
                mergeOutputFormat: 'mp4',
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                addHeader: [
                    'referer:youtube.com',
                    'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                ],
                noPlaylist: true,
                bufferSize: CHUNK_SIZE
            }
        );

        // Add stderr handling
        downloadProcess.stderr.on('data', (data) => {
            console.error('yt-dlp stderr:', data.toString());
        });

        // Handle the download process stdout
        downloadProcess.stdout.on('data', (chunk) => {
            // Stream to player immediately if stream is still active
            if (!isStreamEnded) {
                try {
                    passThrough.write(chunk);
                } catch (error) {
                    console.error('Error writing to stream:', error);
                }
            }

            // Write to file
            if (!fileStream) {
                fileStream = fs.createWriteStream(downloadPath);
            }
            fileStream.write(chunk);
        });

        // Handle download completion
        downloadProcess.stdout.on('end', () => {
            if (!isStreamEnded) {
                passThrough.end();
            }
            if (fileStream) {
                fileStream.end();
            }
            console.log('Download completed successfully');
        });

        // Handle download errors
        downloadProcess.on('error', (error) => {
            console.error('Download error:', error);
            if (!isStreamEnded) {
                passThrough.end();
            }
            if (fileStream) {
                fileStream.end();
                // Remove incomplete file
                fs.unlink(downloadPath, (err) => {
                    if (err) console.error('Error removing incomplete file:', err);
                });
            }
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        });

        // Handle client disconnect
        res.on('close', () => {
            isStreamEnded = true;
            if (fileStream) {
                fileStream.end();
            }
        });

    } catch (error) {
        console.error('Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Create required directories
const dirs = [
    path.join(__dirname, 'downloads'),
    path.join(__dirname, 'public', 'img')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Add this after the routes but before app.listen
// Initial cache update
updateVideosCache();
updateSubscriptionsCache();

// Set up periodic cache updates every 15 minutes
setInterval(updateVideosCache, 15 * 60 * 1000);
setInterval(updateSubscriptionsCache, 15 * 60 * 1000);

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});