const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// ============================================================
// KONFIGURASI
// ============================================================
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const FPS = 30;
const TOTAL_DURATION = 240; // detik
const TOTAL_FRAMES = TOTAL_DURATION * FPS;
const FRAME_DIR = path.join(__dirname, '..', 'frames');
const OUTPUT_DIR = path.join(__dirname, '..', 'out');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'video.mp4');

// ============================================================
// FUNGSI UTILITAS
// ============================================================
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function cleanupFrames() {
    if (fs.existsSync(FRAME_DIR)) {
        const files = fs.readdirSync(FRAME_DIR);
        files.forEach(file => {
            fs.unlinkSync(path.join(FRAME_DIR, file));
        });
        fs.rmdirSync(FRAME_DIR);
    }
}

// ============================================================
// FUNGSI UTAMA
// ============================================================
async function render() {
    console.log('🎬 Memulai proses render video...');
    console.log(`📐 Resolusi: ${CANVAS_WIDTH}x${CANVAS_HEIGHT}`);
    console.log(`🎞️  Total frame: ${TOTAL_FRAMES} (${TOTAL_DURATION} detik @ ${FPS} fps)`);
    console.log('');
    
    // Pastikan direktori ada
    ensureDir(FRAME_DIR);
    ensureDir(OUTPUT_DIR);
    
    let browser;
    try {
        // Launch browser
        console.log('🚀 Menjalankan Puppeteer...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--hide-scrollbars',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set viewport
        await page.setViewport({
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            deviceScaleFactor: 1
        });
        
        // Load HTML
        const htmlPath = path.join(__dirname, '..', 'index.html');
        console.log(`📄 Memuat: ${htmlPath}`);
        await page.goto(`file://${htmlPath}`, {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        
        // Tunggu fonts siap (jika ada)
        await page.evaluate(() => {
            if (document.fonts && document.fonts.ready) {
                return document.fonts.ready;
            }
        });
        
        // Warm-up render
        console.log('🔥 Warm-up render...');
        await page.evaluate(() => window.renderFrame(0));
        await page.evaluate(() => window.renderFrame(0));
        
        // Dapatkan referensi canvas
        const canvas = await page.$('#stage');
        if (!canvas) {
            throw new Error('Canvas element tidak ditemukan!');
        }
        
        // Mulai capture frame
        console.log('📸 Memulai capture frame...');
        const startTime = Date.now();
        
        for (let i = 0; i < TOTAL_FRAMES; i++) {
            const t = i / FPS;
            
            // Render frame
            await page.evaluate((time) => {
                window.renderFrame(time);
            }, t);
            
            // Screenshot canvas
            const framePath = path.join(FRAME_DIR, `frame_${String(i).padStart(5, '0')}.png`);
            await canvas.screenshot({
                path: framePath,
                type: 'png',
                omitBackground: false
            });
            
            // Log progress setiap 100 frame
            if ((i + 1) % 100 === 0 || i === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                const progress = ((i + 1) / TOTAL_FRAMES * 100).toFixed(1);
                console.log(`📊 Progress: ${i + 1}/${TOTAL_FRAMES} frame (${progress}%) - t=${t.toFixed(2)}s - ${elapsed.toFixed(1)}s elapsed`);
            }
        }
        
        const renderTime = (Date.now() - startTime) / 1000;
        console.log(`\n✅ Capture selesai! Waktu: ${renderTime.toFixed(1)} detik`);
        
        // Tutup browser
        await browser.close();
        browser = null;
        
        // Encode video dengan FFmpeg
        console.log('\n🎥 Memulai encoding video dengan FFmpeg...');
        
        // ✅ Gunakan array argumen + execFileSync agar karakter seperti
        //    ( ) * : pada filter -vf TIDAK ditafsirkan oleh shell.
        const ffmpegArgs = [
            '-y',
            '-framerate', String(FPS),
            '-i', path.join(FRAME_DIR, 'frame_%05d.png'),
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            OUTPUT_FILE
        ];
        
        console.log(`⚙️  Command: ffmpeg ${ffmpegArgs.join(' ')}`);
        
        try {
            execFileSync('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
        } catch (ffmpegError) {
            throw new Error(`FFmpeg encoding gagal: ${ffmpegError.message}`);
        }
        
        // Verifikasi output
        if (fs.existsSync(OUTPUT_FILE)) {
            const stats = fs.statSync(OUTPUT_FILE);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            
            console.log(`\n✅ Video berhasil dibuat!`);
            console.log(`📁 Output: ${OUTPUT_FILE}`);
            console.log(`💾 Ukuran: ${fileSizeMB} MB`);
            console.log(`⏱️  Durasi: ${TOTAL_DURATION} detik`);
            console.log(`🎞️  Frame: ${TOTAL_FRAMES}`);
            
            // Cleanup frames
            console.log('\n🧹 Membersihkan frame...');
            cleanupFrames();
            console.log('✅ Frame dihapus');
            
        } else {
            throw new Error('File output tidak ditemukan setelah encoding!');
        }
        
    } catch (error) {
        console.error('\n❌ Error selama render:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Jalankan render
render().then(() => {
    console.log('\n🎉 Render selesai dengan sukses!');
    process.exit(0);
}).catch((error) => {
    console.error('\n💥 Render gagal:', error);
    process.exit(1);
});