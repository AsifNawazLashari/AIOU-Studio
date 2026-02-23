import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import { existsSync, createReadStream, statSync } from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import MarkdownIt from 'markdown-it';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import http from 'http';

// --- CONFIGURATION ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const FONT_PORT = 8097;
const MD_DIR = path.join(__dirname, 'md_storage');
const FONT_DIR = path.join(__dirname, 'fonts');
const THEME_FILE = path.join(__dirname, 'themes.json');
const FONT_FILE = 'Jameel_Noori_Nastaleeq_Kasheeda.ttf'; 
const LOGO_PATH = path.join(__dirname, 'logo.png');

// --- CHROMIUM DETECTION ---
function getChromiumPath() {
    try {
        const path = execSync('which chromium').toString().trim();
        if (path && path.length > 0) return path;
    } catch (e) {
        return '/data/data/com.termux/files/usr/bin/chromium';
    }
    return '/data/data/com.termux/files/usr/bin/chromium';
}

const CHROMIUM_PATH = getChromiumPath();
const md = new MarkdownIt({ html: true });
const app = express();

app.use(bodyParser.json({ limit: '50mb' }));

// --- COMPRESSION HELPER (OPTIMIZED) ---
function compressPDF(inputPath, outputPath) {
    try {
        // Check for Ghostscript
        try { execSync('which gs'); } catch { 
            console.log("Ghostscript not found, skipping compression"); 
            return false; 
        }

        // AGGRESSIVE COMPRESSION COMMAND
        // -dSubsetFonts=true: Removes unused characters from the font (Crucial for Urdu)
        // -dCompressFonts=true: Compresses the font data
        // /ebook: Balanced quality/size (150dpi)
        const cmd = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dSubsetFonts=true -dCompressFonts=true -dDetectDuplicateImages=true -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;
        
        execSync(cmd);
        
        // Check if output exists and is valid
        if (existsSync(outputPath)) {
            return true;
        }
        return false;
    } catch (e) { 
        console.error("Compression Error:", e.message);
        return false; 
    }
}

// --- DEFAULT THEMES ---
const DEFAULT_ENGLISH = `body { font-family: "Times New Roman", Times, serif; line-height: 1.6; color: #333; }
h1 { background: #f4f6f8; color: #3b4455; font-family: Georgia, serif; font-size: 22pt; padding: 20px; text-align: center; border-bottom: 2px solid #1a237e; margin: 0 0 30px 0; }
h2 { color: #1a237e; font-size: 18pt; font-family: Georgia, serif; border-left: 6px solid #1a237e; padding-left: 15px; margin-top: 30px; margin-bottom: 15px; }
p { text-align: justify; margin-bottom: 15px; }`;

// Added format('truetype') to help renderer
const DEFAULT_URDU = `@font-face { font-family: 'JameelNoori'; src: url('http://localhost:${FONT_PORT}/font') format('truetype'); }
body { font-family: 'JameelNoori', 'Noto Nastaliq Urdu', serif; direction: rtl; line-height: 2.4; color: #000; text-align: right; }
.uni-name, .uni-city { font-family: "Times New Roman", serif; direction: ltr; }
.details-table .label-col, .details-table .value-col { text-align: right; padding-right: 20px; }
h1 { background: #f4f6f8; color: #3b4455; font-size: 24pt; padding: 20px; text-align: center; border-bottom: 2px solid #1a237e; margin-bottom: 30px; }
h2 { color: #1a237e; font-size: 20pt; border-right: 6px solid #1a237e; border-left: none; padding-right: 15px; padding-left: 0; margin-top: 30px; text-align: right; }
p { text-align: justify; margin-bottom: 15px; }`;

// --- GLOBAL FONT SERVER ---
const startFontServer = () => {
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/font') {
            const fontPath = path.join(FONT_DIR, FONT_FILE);
            if (!existsSync(fontPath)) {
                res.writeHead(404); res.end('Font not found'); return;
            }
            res.setHeader('Content-Type', 'font/ttf');
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache header
            createReadStream(fontPath).pipe(res);
        } else {
            res.writeHead(404); res.end('Not found');
        }
    });
    server.listen(FONT_PORT, () => console.log(`Font Server running on ${FONT_PORT}`));
    server.on('error', (e) => console.log("Font server status: " + e.code));
};

// --- INITIALIZATION ---
(async () => {
    if (!existsSync(MD_DIR)) await fs.mkdir(MD_DIR, { recursive: true });
    if (!existsSync(FONT_DIR)) await fs.mkdir(FONT_DIR, { recursive: true });
    const themes = await loadThemes();
    await saveThemes(themes);
    startFontServer();
})();

// --- HELPERS ---
async function getLogoSrc() {
    if (existsSync(LOGO_PATH)) {
        const bitmap = await fs.readFile(LOGO_PATH);
        return `data:image/png;base64,${Buffer.from(bitmap).toString('base64')}`;
    }
    return 'https://upload.wikimedia.org/wikipedia/en/e/e4/Allama_Iqbal_Open_University_logo.png';
}

function hasUrduText(text) { 
    if(!text) return false;
    return /[\u0600-\u06FF\u0750-\u077F]/.test(text); 
}

// --- THEME MANAGER ---
async function loadThemes() {
    let t = {};
    if (existsSync(THEME_FILE)) {
        try { t = JSON.parse(await fs.readFile(THEME_FILE, 'utf-8')); } catch (e) {}
    }
    return {
        english: t.english || { "Default": DEFAULT_ENGLISH },
        urdu: t.urdu || { "Default": DEFAULT_URDU },
        activeEnglish: t.activeEnglish || "Default",
        activeUrdu: t.activeUrdu || "Default"
    };
}
async function saveThemes(data) {
    await fs.writeFile(THEME_FILE, JSON.stringify(data, null, 2));
}

// --- PDF BASE CSS ---
const BASE_CSS = `
    * { box-sizing: border-box; }
    @page { size: A4; margin: 0; }
    
    body { 
        margin: 0; 
        background: white;
    }

    .cover-wrapper { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; height: 90vh; width: 100%; }
    .logo-img { width: 140px; margin-bottom: 20px; }
    .assignment-title { font-size: 28pt; font-weight: 800; color: #44546a; border-top: 2px solid #ddd; border-bottom: 2px solid #ddd; padding: 15px 40px; margin-bottom: 40px; background: #f9f9f9; width: 100%; }
    .details-table { width: 100%; border-collapse: collapse; font-size: 14pt; }
    .details-table td { padding: 12px 15px; border: 1px solid #ccc; }
    .details-table .label-col { background: #f0f2f5; font-weight: bold; width: 40%; color: #1a237e; }
    .details-table .value-col { width: 60%; font-weight: bold; }
    .content-body { width: 100%; }
    
    h1 {
        page-break-before: always;
        break-before: page;
        margin-top: 0;
    }

    .page-break { page-break-after: always; }
    img { max-width: 100%; height: auto; display: block; margin: 20px auto; }
`;

const PDF_TEMPLATE = `
<!DOCTYPE html>
<html lang="{{LANG}}">
<head>
    <meta charset="UTF-8">
    <style>{{BASE_CSS}} {{MODE_CSS}}</style>
</head>
<body>
    <div class="cover-wrapper">
        <img src="{{LOGO_SRC}}" alt="Logo" class="logo-img">
        <div class="uni-name" style="font-size:24pt;font-weight:bold;color:#1a237e;margin-bottom:10px;">Allama Iqbal Open University,</div>
        <div class="uni-city" style="font-size:20pt;font-weight:bold;color:#1a237e;margin-bottom:60px;">Islamabad</div>
        <div class="assignment-title">{{ASSIGNMENT_TITLE}}</div>
        <table class="details-table">
            <tr><td class="label-col">{{L_NAME}}</td><td class="value-col">{{V_NAME}}</td></tr>
            <tr><td class="label-col">{{L_ROLL}}</td><td class="value-col">{{V_ROLL}}</td></tr>
            <tr><td class="label-col">{{L_COURSE}}</td><td class="value-col">{{V_COURSE}}</td></tr>
            <tr><td class="label-col">{{L_SEMESTER}}</td><td class="value-col">{{V_SEMESTER}}</td></tr>
        </table>
    </div>
    <div class="page-break"></div>
    <div class="content-body">{{CONTENT}}</div>
</body>
</html>
`;

// --- API ROUTES ---

app.get('/api/files', async (req, res) => {
    try {
        const currentPath = req.query.path || '';
        const dir = path.join(MD_DIR, currentPath);
        if (!dir.startsWith(MD_DIR) || !existsSync(dir)) return res.json([]);
        const files = await fs.readdir(dir, { withFileTypes: true });
        res.json(files.map(d => ({ 
            name: d.name, isDir: d.isDirectory(), relativePath: path.relative(MD_DIR, path.join(dir, d.name))
        })));
    } catch (e) { res.json([]); }
});

app.get('/api/file-content', async (req, res) => {
    try {
        const content = await fs.readFile(path.join(MD_DIR, req.query.path), 'utf-8');
        res.json({ content });
    } catch (e) { res.status(404).send(''); }
});

app.post('/api/save', async (req, res) => {
    const target = path.join(MD_DIR, req.body.path);
    await fs.writeFile(target, req.body.content);
    res.json({ success: true });
});

app.post('/api/folder/create', async (req, res) => {
    const target = path.join(MD_DIR, req.body.path);
    await fs.mkdir(target, { recursive: true });
    res.json({ success: true });
});

app.post('/api/delete', async (req, res) => {
    const target = path.join(MD_DIR, req.body.path);
    await fs.rm(target, { recursive: true, force: true });
    res.json({ success: true });
});

app.post('/api/import', async (req, res) => {
    const target = path.join(MD_DIR, req.body.path, req.body.filename);
    await fs.writeFile(target, req.body.content);
    res.json({ success: true });
});

app.get('/api/themes', async (req, res) => {
    res.json(await loadThemes());
});

app.post('/api/themes/save', async (req, res) => {
    const { lang, name, css } = req.body;
    const themes = await loadThemes();
    if(lang === 'english') themes.english[name] = css;
    else themes.urdu[name] = css;
    await saveThemes(themes);
    res.json({ success: true });
});

app.post('/api/themes/delete', async (req, res) => {
    const { lang, name } = req.body;
    if(name === 'Default') return res.json({success: false, error: 'Cannot delete Default'});
    const themes = await loadThemes();
    if(lang === 'english') delete themes.english[name];
    else delete themes.urdu[name];
    await saveThemes(themes);
    res.json({ success: true });
});

app.post('/api/themes/activate', async (req, res) => {
    const { lang, name } = req.body;
    const themes = await loadThemes();
    if(lang === 'english') themes.activeEnglish = name;
    else themes.activeUrdu = name;
    await saveThemes(themes);
    res.json({ success: true });
});

app.post('/api/magic-find', async (req, res) => {
    const { codes } = req.body;
    try {
        async function findRecursively(dir) {
            let results = [];
            const list = await fs.readdir(dir, { withFileTypes: true });
            for (const file of list) {
                const fullPath = path.join(dir, file.name);
                if (file.isDirectory()) results = results.concat(await findRecursively(fullPath));
                else results.push(fullPath);
            }
            return results;
        }
        const allFiles = await findRecursively(MD_DIR);
        let matches = [];
        for (const code of codes) {
            const regex = new RegExp(`[\\\\/]${code}_(\\d+)\\.md$`);
            const found = allFiles.filter(f => regex.test(f));
            found.forEach(filePath => {
                matches.push({ fullPath: filePath, relativePath: path.relative(MD_DIR, filePath), fileName: path.basename(filePath) });
            });
        }
        res.json({ matches });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- GENERATE PDF ---
app.post('/api/generate-pdf', async (req, res) => {
    let browser;
    let tempHtmlPath = null;
    let tempPdfPath = null;
    
    try {
        const { content, config, filename } = req.body;
        const logoSrc = await getLogoSrc();
        const bodyHtml = md.render(content || '');
        
        const isUrdu = hasUrduText(content);
        const themes = await loadThemes();
        const langCode = isUrdu ? 'ur' : 'en';
        
        const themeMap = isUrdu ? themes.urdu : themes.english;
        const activeName = isUrdu ? themes.activeUrdu : themes.activeEnglish;
        let modeCss = isUrdu ? DEFAULT_URDU : DEFAULT_ENGLISH;
        if (themeMap && activeName && themeMap[activeName]) modeCss = themeMap[activeName];

        let courseCode = "----";
        let assignNum = "1";
        const fileMatch = filename ? filename.match(/^(\d+)_(\d+)/) : null;
        if (fileMatch) {
            courseCode = fileMatch[1];
            assignNum = fileMatch[2];
        }

        let labels = { name: "Submitted By", roll: "Registration Number", course: "Course Code", semester: "Semester" };
        let values = { name: config.name, roll: config.roll, course: courseCode, semester: config.semester };
        let titleLine = `ASSIGNMENT ${assignNum}`;
        
        let footerHtml = `
            <div style="width:100%; text-align:center; font-size:10px; color:#555; padding-top:20px; font-family:sans-serif;">
                Page <span class="pageNumber"></span> of <span class="totalPages"></span>
            </div>`;

        if (isUrdu) {
            labels = { name: "نام طالب علم", roll: "رجسٹریشن نمبر", course: "کورس کوڈ", semester: "سمسٹر" };
            values.name = config.nameUrdu || config.name;
            values.roll = config.rollUrdu || config.roll;
            values.course = courseCode;
            values.semester = config.semesterUrdu || config.semester;
            const urduNumMap = { '1': 'اول', '2': 'دوم', '3': 'سوم', '4': 'چہارم', '5': 'پنجم' };
            const urduNum = urduNumMap[assignNum] || assignNum;
            titleLine = `اسائنمنٹ ${urduNum}`;
            
            footerHtml = `
                <div style="width:100%; text-align:center; font-size:14px; color:#000; padding-top:20px; font-family:'JameelNoori', serif; direction:rtl;">
                    صفحہ نمبر <span class="pageNumber"></span>
                </div>`;
        }

        const finalHtml = PDF_TEMPLATE
            .replace('{{LANG}}', langCode)
            .replace('{{BASE_CSS}}', BASE_CSS)
            .replace('{{MODE_CSS}}', modeCss)
            .replace(/{{LOGO_SRC}}/g, logoSrc)
            .replace('{{ASSIGNMENT_TITLE}}', titleLine)
            .replace('{{L_NAME}}', labels.name).replace('{{V_NAME}}', values.name || '')
            .replace('{{L_ROLL}}', labels.roll).replace('{{V_ROLL}}', values.roll || '')
            .replace('{{L_COURSE}}', labels.course).replace('{{V_COURSE}}', values.course || '')
            .replace('{{L_SEMESTER}}', labels.semester).replace('{{V_SEMESTER}}', values.semester || '')
            .replace('{{CONTENT}}', bodyHtml);

        // --- DETERMINE PATHS ---
        let saveDir;
        if (existsSync('/sdcard')) {
            const safeName = (config.name || 'Student').replace(/[^a-z0-9]/gi, '_');
            saveDir = path.join('/sdcard', safeName);
        } else {
            saveDir = path.join(__dirname, 'Generated_Assignments', (config.name || 'Student').replace(/[^a-z0-9]/gi, '_'));
        }
        if (!existsSync(saveDir)) await fs.mkdir(saveDir, { recursive: true });

        // --- SAVE TEMP HTML FILE (MD -> HTML) ---
        const cleanFilename = filename ? filename.replace('.md', '') : `Assignment_${assignNum}`;
        tempHtmlPath = path.join(saveDir, `temp_${cleanFilename}.html`);
        await fs.writeFile(tempHtmlPath, finalHtml, 'utf-8');

        // --- BROWSER GENERATION ---
        browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        // Load the local HTML file
        await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle' });
        
        // Ensure fonts are actually loaded before printing
        await page.evaluate(async () => {
            await document.fonts.ready;
        });

        const pdfBuffer = await page.pdf({
            format: 'A4', 
            printBackground: true, 
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: footerHtml,
            margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
        });

        // --- SAVE TEMP PDF ---
        const finalPdfName = `${cleanFilename}.pdf`;
        const finalPdfPath = path.join(saveDir, finalPdfName);
        tempPdfPath = path.join(saveDir, `uncompressed_${finalPdfName}`);
        
        await fs.writeFile(tempPdfPath, pdfBuffer);

        // --- COMPRESS ---
        const isCompressed = compressPDF(tempPdfPath, finalPdfPath);
        
        if (!isCompressed) {
            await fs.rename(tempPdfPath, finalPdfPath);
        }

        res.json({ success: true, path: finalPdfPath });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        if (browser) await browser.close();
        // Cleanup temp HTML
        if (tempHtmlPath && existsSync(tempHtmlPath)) await fs.unlink(tempHtmlPath);
        // Cleanup temp PDF if it still exists (if compression worked, tempPdfPath is leftover)
        if (tempPdfPath && existsSync(tempPdfPath)) await fs.unlink(tempPdfPath);
    }
});

// --- FRONTEND UI ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>AIOU Studio Ultimate</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #006064; --bg: #f5f7fa; --surface: #ffffff; }
        body { margin: 0; font-family: 'Inter', sans-serif; background: var(--bg); display: flex; flex-direction: column; height: 100vh; }
        header { background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; border-bottom: 1px solid rgba(0,0,0,0.05); }
        header h1 { margin: 0; font-size: 1.2rem; color: var(--primary); font-weight: 800; }
        main { flex: 1; overflow-y: auto; padding: 20px; padding-bottom: 100px; }
        .tab { display: none; }
        .tab.active { display: block; animation: fadeUp 0.3s ease; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .card { background: var(--surface); border-radius: 16px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); border: 1px solid #fff; }
        .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; color: #555; font-weight: 600; font-size: 0.9rem; text-transform: uppercase; }
        .file-list .item { display: flex; align-items: center; padding: 12px; background: #fff; border: 1px solid #eee; border-radius: 8px; margin-bottom: 8px; cursor: pointer; justify-content: space-between; }
        textarea, input, select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 10px; }
        .btn { width: 100%; padding: 12px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; color: white; background: var(--primary); margin-top: 5px; }
        nav { position: fixed; bottom: 0; width: 100%; background: #fff; display: flex; justify-content: space-around; padding: 12px 0; border-top: 1px solid #eee; z-index: 20; }
        .nav-btn { background: none; border: none; display: flex; flex-direction: column; align-items: center; color: #999; font-size: 0.7rem; font-weight: 600; gap: 4px; }
        .nav-btn.active { color: var(--primary); }
        .nav-btn i { font-size: 1.4rem; }
        .folder-icon { color: #fbc02d; margin-right: 10px; }
        .file-icon { color: #90a4ae; margin-right: 10px; }
        .action-icon { color: #888; margin-left:10px; padding:5px; }
    </style>
</head>
<body>
    <header><h1>AIOU Studio</h1><div id="status">Ready</div></header>
    <main>
        <!-- HOME -->
        <div id="tab-home" class="tab active">
            <div class="card">
                <input type="text" id="magicCode" placeholder="Magic Find (e.g. 1423 1424)">
                <button onclick="magicFind()" class="btn">Find Assignments</button>
            </div>
            <div id="magicResults"></div>
            
            <div class="card" style="margin-top:20px;">
                <div class="card-head">
                    <span id="currentPathLabel">/</span>
                    <div style="display:flex; gap:5px;">
                        <input type="file" id="fileImport" style="display:none" onchange="importFile(this)">
                        <button class="btn" style="width:auto; padding:5px 10px; background:#4caf50;" onclick="document.getElementById('fileImport').click()"><i class="fa-solid fa-upload"></i></button>
                        <button class="btn" style="width:auto; padding:5px 10px; background:#fbc02d;" onclick="createFolder()"><i class="fa-solid fa-folder-plus"></i></button>
                        <button class="btn" style="width:auto; padding:5px 10px; background:#e91e63;" onclick="processCurrentFolder()"><i class="fa-solid fa-print"></i></button>
                    </div>
                </div>
                <div id="explorerList" class="file-list"></div>
            </div>
        </div>

        <!-- EDITOR -->
        <div id="tab-editor" class="tab">
            <div class="card">
                <input type="text" id="fileName" placeholder="File Name">
                <textarea id="editor" rows="15"></textarea>
                <button onclick="saveFile()" class="btn">Save</button>
                <button onclick="generatePdf()" class="btn" style="background:#00897b;">Generate PDF</button>
            </div>
        </div>

        <!-- THEMES -->
        <div id="tab-themes" class="tab">
            <div class="card">
                <div class="card-head">Theme Manager</div>
                <div style="display:flex; gap:5px; margin-bottom:10px;">
                    <select id="themeLang" onchange="renderThemeList()" style="width:50%">
                        <option value="english">English</option>
                        <option value="urdu">Urdu</option>
                    </select>
                    <select id="themeName" onchange="loadThemeContent()" style="width:50%"></select>
                </div>
                <div style="margin-bottom:10px; font-size:12px; color:#666;">
                    Active Theme: <span id="activeThemeLabel" style="font-weight:bold"></span>
                </div>
                <textarea id="themeEditor" rows="10" style="font-family:monospace; font-size:12px;"></textarea>
                
                <div style="display:flex; gap:5px; margin-top:10px;">
                    <button onclick="saveTheme()" class="btn" style="flex:1">Save/Update</button>
                    <button onclick="activateTheme()" class="btn" style="background:#4caf50; flex:1">Set Active</button>
                </div>
                <button onclick="deleteTheme()" class="btn" style="background:#f44336; margin-top:5px;">Delete Theme</button>
            </div>
        </div>

        <!-- SETTINGS -->
        <div id="tab-settings" class="tab">
            <div class="card">
                <div class="card-head">Settings</div>
                <input type="text" id="cfgName" placeholder="Name">
                <input type="text" id="cfgRoll" placeholder="Roll">
                <input type="text" id="cfgSem" placeholder="Semester">
                <hr>
                <input type="text" id="cfgNameUr" placeholder="نام" style="text-align:right">
                <input type="text" id="cfgRollUr" placeholder="رول" style="text-align:right">
                <input type="text" id="cfgSemUr" placeholder="سمسٹر" style="text-align:right">
                <button onclick="saveConfig()" class="btn">Save Config</button>
            </div>
        </div>
    </main>

    <nav>
        <button class="nav-btn active" onclick="switchTab('home')"><i class="fa-solid fa-house"></i></button>
        <button class="nav-btn" onclick="switchTab('editor')"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="nav-btn" onclick="switchTab('themes')"><i class="fa-solid fa-palette"></i></button>
        <button class="nav-btn" onclick="switchTab('settings')"><i class="fa-solid fa-gear"></i></button>
    </nav>

    <script>
        let currentPath = '';
        let themesData = {};

        // --- INIT ---
        loadExplorer('');
        loadThemes();
        const config = JSON.parse(localStorage.getItem('aiou_config') || '{}');
        ['cfgName','cfgRoll','cfgSem','cfgNameUr','cfgRollUr','cfgSemUr'].forEach(id => {
            if(config[id]) document.getElementById(id).value = config[id];
        });

        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('tab-'+tab).classList.add('active');
            event.currentTarget.classList.add('active');
        }

        // --- THEMES ---
        async function loadThemes() {
            const res = await fetch('/api/themes');
            themesData = await res.json();
            renderThemeList();
        }

        function renderThemeList() {
            const lang = document.getElementById('themeLang').value;
            const list = document.getElementById('themeName');
            const data = lang === 'english' ? themesData.english : themesData.urdu;
            const active = lang === 'english' ? themesData.activeEnglish : themesData.activeUrdu;
            document.getElementById('activeThemeLabel').innerText = active;
            list.innerHTML = '';
            const optNew = document.createElement('option');
            optNew.value = '__NEW__';
            optNew.innerText = '+ Create New Theme';
            list.appendChild(optNew);
            Object.keys(data).forEach(k => {
                const opt = document.createElement('option');
                opt.value = k;
                opt.innerText = k + (k === active ? ' (Active)' : '');
                list.appendChild(opt);
            });
            loadThemeContent();
        }

        function loadThemeContent() {
            const lang = document.getElementById('themeLang').value;
            const name = document.getElementById('themeName').value;
            if(name === '__NEW__') {
                document.getElementById('themeEditor').value = '';
            } else {
                const data = lang === 'english' ? themesData.english : themesData.urdu;
                document.getElementById('themeEditor').value = data[name];
            }
        }

        async function saveTheme() {
            const lang = document.getElementById('themeLang').value;
            let name = document.getElementById('themeName').value;
            const css = document.getElementById('themeEditor').value;
            if(name === '__NEW__') {
                name = prompt("Enter Theme Name:");
                if(!name) return;
            }
            await fetch('/api/themes/save', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({lang, name, css})
            });
            await loadThemes();
        }

        async function activateTheme() {
            const lang = document.getElementById('themeLang').value;
            const name = document.getElementById('themeName').value;
            if(name === '__NEW__') return alert("Save it first");
            await fetch('/api/themes/activate', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({lang, name})
            });
            await loadThemes();
        }

        async function deleteTheme() {
            const lang = document.getElementById('themeLang').value;
            const name = document.getElementById('themeName').value;
            if(name === '__NEW__') return;
            if(!confirm("Delete theme: " + name + "?")) return;
            const res = await fetch('/api/themes/delete', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({lang, name})
            });
            const d = await res.json();
            if(d.success) await loadThemes();
            else alert(d.error);
        }

        // --- EXPLORER & CRUD ---
        async function loadExplorer(path) {
            currentPath = path;
            document.getElementById('currentPathLabel').innerText = path || '/';
            const res = await fetch('/api/files?path=' + path);
            const files = await res.json();
            const list = document.getElementById('explorerList');
            list.innerHTML = '';
            if (path) {
                 const upDiv = document.createElement('div');
                 upDiv.className = 'item';
                 upDiv.innerHTML = '<div><i class="fa-solid fa-turn-up folder-icon"></i> ..</div>';
                 const parentPath = path.split('/').slice(0,-1).join('/');
                 upDiv.onclick = () => loadExplorer(parentPath);
                 list.appendChild(upDiv);
            }
            files.forEach(f => {
                const d = document.createElement('div');
                d.className = 'item';
                const icon = f.isDir ? '<i class="fa-solid fa-folder folder-icon"></i>' : '<i class="fa-solid fa-file-lines file-icon"></i>';
                d.innerHTML = '<div>' + icon + f.name + '</div>';
                d.onclick = (e) => {
                    if(e.target.tagName === 'I' && e.target.classList.contains('fa-trash')) return; 
                    if (f.isDir) loadExplorer(f.relativePath);
                    else loadFile(f.relativePath);
                };
                const delBtn = document.createElement('i');
                delBtn.className = 'fa-solid fa-trash action-icon';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteItem(f.relativePath);
                };
                d.appendChild(delBtn);
                list.appendChild(d);
            });
        }

        async function createFolder() {
            const name = prompt("Folder Name:");
            if(!name) return;
            await fetch('/api/folder/create', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ path: currentPath ? currentPath + '/' + name : name })
            });
            loadExplorer(currentPath);
        }

        async function deleteItem(path) {
            if(!confirm("Delete " + path + "?")) return;
            await fetch('/api/delete', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ path })
            });
            loadExplorer(currentPath);
        }

        function importFile(input) {
            const file = input.files[0];
            if(!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                await fetch('/api/import', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ 
                        path: currentPath, 
                        filename: file.name, 
                        content: e.target.result 
                    })
                });
                loadExplorer(currentPath);
            };
            reader.readAsText(file);
        }

        // --- GENERATION LOGIC ---
        async function processCurrentFolder() {
            const res = await fetch('/api/files?path=' + currentPath);
            const files = await res.json();
            const mdFiles = files.filter(f => !f.isDir && f.name.endsWith('.md'));
            if(mdFiles.length === 0) return alert('No Markdown files here.');
            if(!confirm("Generate " + mdFiles.length + " PDFs?")) return;
            const status = document.getElementById('status');
            for(let i=0; i<mdFiles.length; i++) {
                status.innerText = "Processing " + (i+1) + "/" + mdFiles.length;
                const f = mdFiles[i];
                const cRes = await fetch('/api/file-content?path='+f.relativePath);
                const cData = await cRes.json();
                await doGenerate(cData.content, f.name, false);
            }
            status.innerText = "Ready";
            alert("Batch Complete");
        }

        async function magicFind() {
            const codes = document.getElementById('magicCode').value.split(' ').filter(c=>c);
            const res = await fetch('/api/magic-find', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ codes })
            });
            const data = await res.json();
            const resDiv = document.getElementById('magicResults');
            resDiv.innerHTML = '';
            if(data.matches.length > 0) {
                const btn = document.createElement('button');
                btn.className = 'btn';
                btn.style.background = '#e91e63';
                btn.innerText = 'Generate All (' + data.matches.length + ')';
                btn.onclick = async () => {
                     for(let i=0; i<data.matches.length; i++) {
                        document.getElementById('status').innerText = 'Magic: '+(i+1);
                        const m = data.matches[i];
                        const cRes = await fetch('/api/file-content?path='+m.relativePath);
                        const cData = await cRes.json();
                        await doGenerate(cData.content, m.fileName, false);
                    }
                    document.getElementById('status').innerText = 'Ready';
                    alert("Done");
                };
                resDiv.appendChild(btn);
            }
        }

        // --- EDITOR & CONFIG ---
        async function loadFile(path) {
            const res = await fetch('/api/file-content?path='+path);
            const data = await res.json();
            document.getElementById('fileName').value = path.split('/').pop();
            document.getElementById('editor').value = data.content;
            switchTab('editor');
        }

        async function saveFile() {
            const content = document.getElementById('editor').value;
            const name = document.getElementById('fileName').value;
            const fullPath = currentPath ? currentPath + '/' + name : name;
            await fetch('/api/save', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ path: fullPath, content })
            });
            alert('Saved');
            loadExplorer(currentPath);
        }

        function saveConfig() {
            const cfg = {};
            ['cfgName','cfgRoll','cfgSem','cfgNameUr','cfgRollUr','cfgSemUr'].forEach(id => {
                cfg[id] = document.getElementById(id).value;
            });
            localStorage.setItem('aiou_config', JSON.stringify(cfg));
            alert('Settings Saved');
        }

        async function generatePdf() {
            const content = document.getElementById('editor').value;
            const filename = document.getElementById('fileName').value;
            document.getElementById('status').innerText = 'Generating...';
            await doGenerate(content, filename, true);
            document.getElementById('status').innerText = 'Ready';
        }

        async function doGenerate(content, filename, showAlert) {
            const cfg = JSON.parse(localStorage.getItem('aiou_config') || '{}');
            const conf = {
                name: cfg.cfgName, roll: cfg.cfgRoll, semester: cfg.cfgSem,
                nameUrdu: cfg.cfgNameUr, rollUrdu: cfg.cfgRollUr, semesterUrdu: cfg.cfgSemUr
            };
            try {
                const res = await fetch('/api/generate-pdf', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ content, config: conf, filename })
                });
                const data = await res.json();
                if(showAlert) {
                    if(data.success) alert('PDF Saved: ' + data.path);
                    else alert('Error: ' + data.error);
                }
            } catch(e) { console.error(e); }
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
