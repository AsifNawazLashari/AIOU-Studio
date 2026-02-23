import express from 'express';
import fs from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import MarkdownIt from 'markdown-it';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const FONT_PORT = 8097;
const MD_DIR = path.join(__dirname, 'md_storage');
const FONT_DIR = path.join(__dirname, 'fonts');
const THEME_FILE = path.join(__dirname, 'themes.json');
const FONT_FILE = 'Jameel_Noori_Nastaleeq_Kasheeda.ttf'; 
const LOGO_PATH = path.join(__dirname, 'logo.png');

const md = new MarkdownIt({ html: true });
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

function safeJoin(base, target) {
    const targetPath = target || '';
    const resolvedPath = path.join(base, targetPath);
    if (!resolvedPath.startsWith(base)) throw new Error("Forbidden Path Access");
    return resolvedPath;
}

function compressPDF(inputPath, outputPath) {
    try {
        try { execSync('which gs'); } catch { return false; }
        const cmd = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dSubsetFonts=true -dCompressFonts=true -dDetectDuplicateImages=true -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;
        execSync(cmd);
        return existsSync(outputPath);
    } catch (e) { return false; }
}

const DEFAULT_ENGLISH = `body { font-family: "Times New Roman", Times, serif; line-height: 1.6; color: #333; }\nh1 { background: #f4f6f8; color: #3b4455; font-family: Georgia, serif; font-size: 22pt; padding: 20px; text-align: center; border-bottom: 2px solid #1a237e; margin: 0 0 30px 0; }\nh2 { color: #1a237e; font-size: 18pt; font-family: Georgia, serif; border-left: 6px solid #1a237e; padding-left: 15px; margin-top: 30px; margin-bottom: 15px; }\np { text-align: justify; margin-bottom: 15px; }`;
const DEFAULT_URDU = `@font-face { font-family: 'JameelNoori'; src: url('http://localhost:${FONT_PORT}/font') format('truetype'); }\nbody { font-family: 'JameelNoori', 'Noto Nastaliq Urdu', serif; direction: rtl; line-height: 2.4; color: #000; text-align: right; }\n.uni-name, .uni-city { font-family: "Times New Roman", serif; direction: ltr; }\n.details-table .label-col, .details-table .value-col { text-align: right; padding-right: 20px; }\nh1 { background: #f4f6f8; color: #3b4455; font-size: 24pt; padding: 20px; text-align: center; border-bottom: 2px solid #1a237e; margin-bottom: 30px; }\nh2 { color: #1a237e; font-size: 20pt; border-right: 6px solid #1a237e; border-left: none; padding-right: 15px; padding-left: 0; margin-top: 30px; text-align: right; }\np { text-align: justify; margin-bottom: 15px; }`;

const startFontServer = () => {
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/font') {
            const fontPath = path.join(FONT_DIR, FONT_FILE);
            if (!existsSync(fontPath)) { res.writeHead(404); res.end('Font not found'); return; }
            res.setHeader('Content-Type', 'font/ttf');
            res.setHeader('Cache-Control', 'public, max-age=31536000'); 
            createReadStream(fontPath).pipe(res);
        } else { res.writeHead(404); res.end('Not found'); }
    });
    server.listen(FONT_PORT, () => console.log(`Font Server running on ${FONT_PORT}`));
};

(async () => {
    if (!existsSync(MD_DIR)) await fs.mkdir(MD_DIR, { recursive: true });
    if (!existsSync(FONT_DIR)) await fs.mkdir(FONT_DIR, { recursive: true });
    const themes = await loadThemes();
    await saveThemes(themes);
    startFontServer();
})();

async function getLogoSrc() {
    if (existsSync(LOGO_PATH)) {
        const bitmap = await fs.readFile(LOGO_PATH);
        return `data:image/png;base64,${Buffer.from(bitmap).toString('base64')}`;
    }
    return 'https://upload.wikimedia.org/wikipedia/en/e/e4/Allama_Iqbal_Open_University_logo.png';
}

function hasUrduText(text) { return /[\u0600-\u06FF\u0750-\u077F]/.test(text || ''); }

async function loadThemes() {
    let t = {};
    if (existsSync(THEME_FILE)) {
        try { t = JSON.parse(await fs.readFile(THEME_FILE, 'utf-8')); } catch (e) {}
    }
    return {
        english: t.english || { "Default": DEFAULT_ENGLISH }, urdu: t.urdu || { "Default": DEFAULT_URDU },
        activeEnglish: t.activeEnglish || "Default", activeUrdu: t.activeUrdu || "Default"
    };
}
async function saveThemes(data) { await fs.writeFile(THEME_FILE, JSON.stringify(data, null, 2)); }

const BASE_CSS = `* { box-sizing: border-box; } @page { size: A4; margin: 0; } body { margin: 0; background: white; } .cover-wrapper { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; height: 90vh; width: 100%; } .logo-img { width: 140px; margin-bottom: 20px; } .assignment-title { font-size: 28pt; font-weight: 800; color: #44546a; border-top: 2px solid #ddd; border-bottom: 2px solid #ddd; padding: 15px 40px; margin-bottom: 40px; background: #f9f9f9; width: 100%; } .details-table { width: 100%; border-collapse: collapse; font-size: 14pt; } .details-table td { padding: 12px 15px; border: 1px solid #ccc; } .details-table .label-col { background: #f0f2f5; font-weight: bold; width: 40%; color: #1a237e; } .details-table .value-col { width: 60%; font-weight: bold; } .content-body { width: 100%; } h1 { page-break-before: always; break-before: page; margin-top: 0; } .page-break { page-break-after: always; } img { max-width: 100%; height: auto; display: block; margin: 20px auto; }`;
const PDF_TEMPLATE = `<!DOCTYPE html><html lang="{{LANG}}"><head><meta charset="UTF-8"><style>{{BASE_CSS}} {{MODE_CSS}}</style></head><body><div class="cover-wrapper"><img src="{{LOGO_SRC}}" alt="Logo" class="logo-img"><div class="uni-name" style="font-size:24pt;font-weight:bold;color:#1a237e;margin-bottom:10px;">Allama Iqbal Open University,</div><div class="uni-city" style="font-size:20pt;font-weight:bold;color:#1a237e;margin-bottom:60px;">Islamabad</div><div class="assignment-title">{{ASSIGNMENT_TITLE}}</div><table class="details-table"><tr><td class="label-col">{{L_NAME}}</td><td class="value-col">{{V_NAME}}</td></tr><tr><td class="label-col">{{L_ROLL}}</td><td class="value-col">{{V_ROLL}}</td></tr><tr><td class="label-col">{{L_COURSE}}</td><td class="value-col">{{V_COURSE}}</td></tr><tr><td class="label-col">{{L_SEMESTER}}</td><td class="value-col">{{V_SEMESTER}}</td></tr></table></div><div class="page-break"></div><div class="content-body">{{CONTENT}}</div></body></html>`;

// API
app.get('/api/files', async (req, res) => {
    try {
        const dir = safeJoin(MD_DIR, req.query.path);
        if (!existsSync(dir)) return res.json([]);
        const files = await fs.readdir(dir, { withFileTypes: true });
        res.json(files.map(d => ({ name: d.name, isDir: d.isDirectory(), relativePath: path.relative(MD_DIR, path.join(dir, d.name)) })));
    } catch (e) { res.json([]); }
});
app.get('/api/file-content', async (req, res) => {
    try { res.json({ content: await fs.readFile(safeJoin(MD_DIR, req.query.path), 'utf-8') }); } catch (e) { res.status(404).send(''); }
});
app.post('/api/save', async (req, res) => {
    try { await fs.writeFile(safeJoin(MD_DIR, req.body.path), req.body.content); res.json({ success: true }); } catch (e) { res.status(400).json({ success: false }); }
});
app.post('/api/folder/create', async (req, res) => {
    try { await fs.mkdir(safeJoin(MD_DIR, req.body.path), { recursive: true }); res.json({ success: true }); } catch (e) { res.status(400).json({ success: false }); }
});
app.post('/api/delete', async (req, res) => {
    try { await fs.rm(safeJoin(MD_DIR, req.body.path), { recursive: true, force: true }); res.json({ success: true }); } catch (e) { res.status(400).json({ success: false }); }
});
app.post('/api/import', async (req, res) => {
    try { await fs.writeFile(safeJoin(MD_DIR, path.join(req.body.path, req.body.filename)), req.body.content); res.json({ success: true }); } catch (e) { res.status(400).json({ success: false }); }
});

app.get('/api/themes', async (req, res) => { res.json(await loadThemes()); });
app.post('/api/themes/save', async (req, res) => {
    const themes = await loadThemes();
    themes[req.body.lang][req.body.name] = req.body.css;
    await saveThemes(themes); res.json({ success: true });
});
app.post('/api/themes/delete', async (req, res) => {
    if(req.body.name === 'Default') return res.json({success: false});
    const themes = await loadThemes();
    delete themes[req.body.lang][req.body.name];
    await saveThemes(themes); res.json({ success: true });
});
app.post('/api/themes/activate', async (req, res) => {
    const themes = await loadThemes();
    if(req.body.lang === 'english') themes.activeEnglish = req.body.name;
    else themes.activeUrdu = req.body.name;
    await saveThemes(themes); res.json({ success: true });
});

app.post('/api/magic-find', async (req, res) => {
    try {
        async function findRecursively(dir) {
            let results = [];
            for (const file of await fs.readdir(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, file.name);
                if (file.isDirectory()) results = results.concat(await findRecursively(fullPath));
                else results.push(fullPath);
            }
            return results;
        }
        const allFiles = await findRecursively(MD_DIR);
        let matches = [];
        for (const code of req.body.codes) {
            const regex = new RegExp(`[\\\\/]${code}_(\\d+)\\.md$`);
            allFiles.filter(f => regex.test(f)).forEach(fp => matches.push({ fullPath: fp, relativePath: path.relative(MD_DIR, fp), fileName: path.basename(fp) }));
        }
        res.json({ matches });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GENERATE PDF
app.post('/api/generate-pdf', async (req, res) => {
    let browser; let page; let tempHtmlPath; let tempPdfPath;
    try {
        const { content, config, filename } = req.body;
        const logoSrc = await getLogoSrc();
        const bodyHtml = md.render(content || '');
        const isUrdu = hasUrduText(content);
        const themes = await loadThemes();
        const themeMap = isUrdu ? themes.urdu : themes.english;
        const activeName = isUrdu ? themes.activeUrdu : themes.activeEnglish;
        let modeCss = themeMap[activeName] || (isUrdu ? DEFAULT_URDU : DEFAULT_ENGLISH);

        let courseCode = "----"; let assignNum = "1";
        const fileMatch = filename ? filename.match(/^(\d+)_(\d+)/) : null;
        if (fileMatch) { courseCode = fileMatch[1]; assignNum = fileMatch[2]; }

        let labels = { name: "Submitted By", roll: "Registration Number", course: "Course Code", semester: "Semester" };
        let values = { name: config.name, roll: config.roll, course: courseCode, semester: config.semester };
        let titleLine = `ASSIGNMENT ${assignNum}`;
        let footerHtml = `<div style="width:100%; text-align:center; font-size:10px; color:#555; padding-top:20px; font-family:sans-serif;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

        if (isUrdu) {
            labels = { name: "نام طالب علم", roll: "رجسٹریشن نمبر", course: "کورس کوڈ", semester: "سمسٹر" };
            values.name = config.nameUrdu || config.name; values.roll = config.rollUrdu || config.roll; values.semester = config.semesterUrdu || config.semester;
            titleLine = `اسائنمنٹ ${{ '1': 'اول', '2': 'دوم', '3': 'سوم', '4': 'چہارم', '5': 'پنجم' }[assignNum] || assignNum}`;
            footerHtml = `<div style="width:100%; text-align:center; font-size:14px; color:#000; padding-top:20px; font-family:'JameelNoori', serif; direction:rtl;">صفحہ نمبر <span class="pageNumber"></span></div>`;
        }

        const finalHtml = PDF_TEMPLATE.replace('{{LANG}}', isUrdu ? 'ur' : 'en').replace('{{BASE_CSS}}', BASE_CSS).replace('{{MODE_CSS}}', modeCss).replace(/{{LOGO_SRC}}/g, logoSrc).replace('{{ASSIGNMENT_TITLE}}', titleLine).replace('{{L_NAME}}', labels.name).replace('{{V_NAME}}', values.name || '').replace('{{L_ROLL}}', labels.roll).replace('{{V_ROLL}}', values.roll || '').replace('{{L_COURSE}}', labels.course).replace('{{V_COURSE}}', values.course || '').replace('{{L_SEMESTER}}', labels.semester).replace('{{V_SEMESTER}}', values.semester || '').replace('{{CONTENT}}', bodyHtml);

        let saveDir = path.join(__dirname, 'Generated_Assignments', (config.name || 'Student').replace(/[^a-z0-9]/gi, '_'));
        if (!existsSync(saveDir)) await fs.mkdir(saveDir, { recursive: true });

        const cleanFilename = filename ? filename.replace('.md', '') : `Assignment_${assignNum}`;
        tempHtmlPath = path.join(saveDir, `temp_${cleanFilename}.html`);
        await fs.writeFile(tempHtmlPath, finalHtml, 'utf-8');

        let execPath = null;
        try { execPath = execSync('which chromium').toString().trim(); } catch(e) {}
        if(!execPath && existsSync('/data/data/com.termux/files/usr/bin/chromium')) execPath = '/data/data/com.termux/files/usr/bin/chromium';

        const launchArgs = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
        if (execPath) launchArgs.executablePath = execPath;

        browser = await chromium.launch(launchArgs);
        page = await browser.newPage();
        await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle' });
        await page.evaluate(async () => { await document.fonts.ready; });

        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: footerHtml, margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' } });

        const finalPdfPath = path.join(saveDir, `${cleanFilename}.pdf`);
        tempPdfPath = path.join(saveDir, `uncompressed_${cleanFilename}.pdf`);
        await fs.writeFile(tempPdfPath, pdfBuffer);

        if (!compressPDF(tempPdfPath, finalPdfPath)) await fs.rename(tempPdfPath, finalPdfPath);
        res.json({ success: true, path: finalPdfPath });

    } catch (e) { res.status(500).json({ success: false, error: e.message });
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
        if (tempHtmlPath && existsSync(tempHtmlPath)) await fs.unlink(tempHtmlPath);
        if (tempPdfPath && existsSync(tempPdfPath)) await fs.unlink(tempPdfPath);
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
