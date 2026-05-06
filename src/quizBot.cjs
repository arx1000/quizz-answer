#!/usr/bin/env node
const { chromium } = require('playwright');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

let server = null;

async function startServerIfNeeded(serveDir) {
  if (!serveDir) return null;
  const dir = path.resolve(serveDir);
  if (!fs.existsSync(dir)) return null;
  
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const filePath = path.join(dir, req.url === '/' ? 'index.html' : req.url);
      const ext = path.extname(filePath);
      const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    srv.listen(0, () => {
      resolve({ server: srv, port: srv.address().port });
    });
  });
}

async function callAI(apiKey, pageText) {
  console.log('\n=== Asking AI for answers ===');
  const prompt = `Analyze this quiz and determine correct answers.
Quiz: ${pageText.slice(0, 4000)}
Respond JSON: [{"q":"question","a":"answer"}]`;

  const body = JSON.stringify({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.choices?.[0]?.message?.content) resolve(j.choices[0].message.content);
          else reject(new Error(j.error?.message || 'No response'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function autoAnswerQuiz(page, aiAnswers) {
  // Try AI answers first
  if (aiAnswers?.length > 0) {
    console.log('Using AI answers:', aiAnswers);
    try {
      const radios = await page.$$('input[type="radio"]');
      console.log('Found ' + radios.length + ' radios');
      
      // Group by question name
      for (const r of radios) {
        const nameProp = await r.getProperty('name');
        const name = await nameProp.jsonValue();
        const valProp = await r.getProperty('value');
        const val = String(await valProp.jsonValue()).toLowerCase();
        
        // Check if this answer matches ANY AI answer for this question
        for (const a of aiAnswers) {
          const ans = (a.a || a.answer || '').toLowerCase();
          
          // Exact match or partial
          if (val === ans || val.includes(ans) || ans.includes(val)) {
            console.log('AI selected: ' + val);
            await r.click();
            await page.waitForTimeout(300);
            break; // Only one per question
          }
        }
      }
    } catch(e) { console.log('AI match error:', e.message); }
  }

  // Try custom checkbox buttons (Blackboard, Moodle, etc.)
  if (!aiAnswers?.length || true) {
    console.log('Checking custom buttons...');
    try {
      const checkboxes = await page.$$('button[role="checkbox"]');
      console.log('Found ' + checkboxes.length + ' checkbox buttons');
      for (const cb of checkboxes) {
        const ariaLabel = await cb.getProperty('aria-label').then(p => p.jsonValue());
        const ariaChecked = await cb.getProperty('aria-checked').then(p => p.jsonValue());
        if (ariaChecked === 'false' && ariaLabel) {
          console.log('Clicking: ' + ariaLabel.substring(0,50));
          await cb.click();
          await page.waitForTimeout(300);
        }
      }
    } catch(e) { console.log('Checkbox error:', e.message); }
    
    // Try self-confidence buttons (I Know It, Think So, Not Sure, No Idea)
    try {
      const selfConf = await page.$$('button[aria-label*="I Know It"], button[aria-label*="Think So"], button[aria-label*="Not Sure"], button[aria-label*="No Idea"]');
      console.log('Found ' + selfConf.length + ' self-confidence buttons');
      for (const btn of selfConf) {
        const label = await btn.getProperty('aria-label').then(p => p.jsonValue());
        console.log('Self-conf: ' + label);
        await btn.click();
        await page.waitForTimeout(300);
      }
    } catch(e) { console.log('Self-conf error:', e.message); }
  }

  // Fallback - random answers (works on any quiz)
  if (!aiAnswers?.length) {
    console.log('Using random answers');
    try {
      const radios = await page.$$('input[type="radio"]');
      const seen = new Set();
      for (const r of radios) {
        const name = await r.getProperty('name').then(p => p.jsonValue());
        if (!name || seen.has(name)) continue;
        const v = await r.getProperty('value').then(p => p.jsonValue());
        console.log('Random: ' + v);
        await r.click();
        await page.waitForTimeout(200);
        seen.add(name);
      }
    } catch(e) { console.log('Radio error:', e.message); }
  }

  // Submit
  try {
    await page.click('button[type="submit"]');
    console.log('Submitted');
  } catch(e) {
    // Try in iframes
    try {
      const frames = page.frames();
      for (const frame of frames) {
        try {
          await frame.click('button[type="submit"]', { raises: false });
        } catch(e) {}
      }
    } catch(e) {}
  }
}

function parseArgs() {
  const a = process.argv, r = { url: null, headful: true, serveDir: null, aiKey: null, waitLogin: false, stayOpen: false };
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--url' && i+1 < a.length) r.url = a[++i];
    if (a[i] === '--ai-key' && i+1 < a.length) r.aiKey = a[++i];
    if (a[i] === '--serve' && i+1 < a.length) r.serveDir = a[++i];
    if (a[i] === '--stay-open') r.stayOpen = true;
    if (a[i] === '--wait-login') r.waitLogin = true;
    if (a[i] === '--headless') r.headful = false;
  }
  return r;
}

async function main() {
  let { url, headful, serveDir, aiKey, waitLogin, stayOpen } = parseArgs();
  
  if (!url) {
    console.log('Usage: node quizBot.cjs --url <URL> [--ai-key KEY] [--serve DIR] [--stay-open] [--wait-login]');
    process.exit(1);
  }

  let serverInfo = null;
  if (serveDir) {
    serverInfo = await startServerIfNeeded(serveDir);
    if (serverInfo) url = `http://127.0.0.1:${serverInfo.port}/${url}`;
  }

  const browser = await chromium.launch({ headless: !headful });
  const page = await browser.newPage();

  if (waitLogin) {
    console.log('Open browser, log in, navigate to quiz IN THE BROWSER, then press Enter...');
    await page.goto(url);
    console.log('Waiting 5 seconds for page to load...');
    await page.waitForTimeout(5000);
    console.log('Page loaded. Title:', await page.title());
    console.log('Taking screenshot to see what loaded...');
    await page.screenshot({ path: 'debug.png' });
    await new Promise(r => {
      const rl = require('readline').createInterface({input:process.stdin,output:process.stdout});
      rl.question('', x => { rl.close(); r(); });
    });
  } else {
    await page.goto(url);
  }

  // Wait a bit for iframes to load
  await page.waitForTimeout(3000);
  
  // Get page text from main page OR iframes
  let text = '';
  try {
    text = await page.evaluate(() => document.body.innerText);
  } catch(e) {}
  
  // Try to get text from all iframes
  try {
    const frames = page.frames();
    console.log('Found ' + frames.length + ' frames');
    for (let i = 0; i < frames.length; i++) {
      try {
        const frameText = await frames[i].evaluate(() => document.body.innerText).catch(() => '');
        if (frameText && frameText.length > text.length && frameText.length > 100) {
          console.log('Frame ' + i + ' has more text, using that');
          text = frameText;
        }
      } catch(e) {}
    }
  } catch(e) { console.log('Frame error:', e.message); }
  
  console.log('Extracted ' + text.length + ' chars');
  let aiAnswers = null;
  if (aiKey && text.length > 10) {
    try {
      const resp = await callAI(aiKey, text);
      console.log('AI raw:', resp.slice(0, 200));
      try { aiAnswers = JSON.parse(resp); console.log('Parsed:', aiAnswers); } 
      catch(e) { console.log('Parse failed, no answers from AI'); aiAnswers = null; }
    } catch(e) { console.log('AI error:', e.message); }
  }

  await autoAnswerQuiz(page, aiAnswers);
  await page.screenshot({ path: 'result.png' });
  console.log('Saved result.png');

  if (!stayOpen) await browser.close();
  if (serverInfo) serverInfo.server.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });