# 🚀 NexusConvert

<h3 align="center">All-in-One Media Downloader & Universal File Processing Platform</h3>

<p align="center">
  A high-performance, dark-themed, glassmorphic full-stack web application for media extraction and multi-format file conversion built with modern JavaScript and Node.js.
</p>

---

## 🌟 Key Features

### 🎬 1. Media URL Downloader (YouTube & Web Media)
- **High-Quality Extraction**: Download YouTube videos and audio streams seamlessly using `yt-dlp-exec`.
- **Multiple Formats & Quality Options**:
  - **Audio**: MP3 (128kbps, 192kbps, 320kbps), WAV, M4A, AAC, FLAC.
  - **Video**: MP4 (360p, 480p, 720p HD, 1080p Full HD, 4K), WEBM, 3GP.
- **Smart URL Sanitization**: Automatically strips playlist parameters (`&list=...`) to prevent metadata fetch errors.
- **Title Retention**: Extracted output files retain their original UTF-8 / Unicode titles (including Turkish characters, accents, and special symbols).

### 🔄 2. Universal File Converter
- **Broad Format Support**:
  - **Images**: PNG, JPG, JPEG, WEBP, SVG, GIF, ICO, BMP, TIFF, AVIF, HEIC, PDF.
  - **Documents**: PDF, DOCX, TXT, HTML, EPUB, RTF, ODT, XLSX, CSV.
  - **Audio**: MP3, WAV, OGG, FLAC, AAC, M4A, OPUS, AIFF, WMA.
  - **Video**: MP4, AVI, MKV, MOV, WEBM, FLV, WMV, 3GP, M4V.
- **Large File Handling**: Built-in support for processing large files up to **1GB** without memory overflow (stream-based transfers).
- **Unicode Filename Sync**: Preserves original uploaded file names across all browsers using RFC 5987 UTF-8 header standards.
- **Interactive Queue Management**: Integrated status badge counter, drag-and-drop batch upload area, and null-state target format selection.

### 🎨 3. Modern Dark Glassmorphism UI & Responsive Layout
- **Glassmorphic Theme**: Deep dark slate palette (`#0a0d14`), frosted glass blur effects (`backdrop-filter: blur(16px)`), and neon glowing accents (`#00f2fe`).
- **Collapsible Sidebar**: Desktop sidebar shrinks into clean, centered 80px square icon boxes in collapsed state.
- **Mobile Off-Screen Drawer**: Responsive hamburger menu drawer for seamless mobile & tablet user experience.

---

## 💻 Tech Stack

- **Frontend**: HTML5, CSS3 (Custom Glassmorphic Styling, Flexbox/Grid), Vanilla JavaScript (ES6+).
- **Backend**: Node.js, Express.js (REST API, Stream Handling).
- **Processing Engines**:
  - `yt-dlp-exec`: High-reliability media URL metadata extraction and stream downloading.
  - `fluent-ffmpeg` & `ffmpeg-static`: Multi-format audio/video encoding and conversion engine.
  - `multer`: UTF-8 compliant multipart file upload processing.

---

## 📁 Folder Structure

```text
Nexus-Convert/
├── public/
│   ├── css/
│   │   ├── glassmorphism.css  # Dark translucent glass styling & custom variables
│   │   └── style.css          # Core layouts, sidebar transitions & responsiveness
│   ├── js/
│   │   ├── app.js             # Navigation, tabs & mobile drawer controller
│   │   ├── converter.js       # File upload & conversion queue logic
│   │   └── downloader.js      # Media URL fetching & download UI state
│   └── index.html             # Single-page application template
├── routes/
│   ├── convertRoute.js        # Universal conversion endpoints
│   └── downloadRoute.js       # URL metadata & download handlers
├── downloads/                 # Temporary media downloads storage
├── uploads/                   # Temporary file uploads buffer
├── temp/                      # Processing temp workspace
├── server.js                  # Main Express server configuration & timeouts
└── package.json               # Project dependencies & startup scripts
