// Usage: node asset-source/fog/capture.mjs [absolute path to playwright/index.mjs]
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.argv[2]||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'public/fog/images');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:4178/fog/review.html',{waitUntil:'networkidle'});
await page.waitForFunction(()=>window.assetReview!==undefined);
await page.screenshot({path:path.join(out,'asset-review.png')});
const models=JSON.parse(await fs.readFile(path.join(root,'public/fog/models.json'),'utf8'));
const thumbs=[];
for(const a of models.assets){
 for(const state of a.category==='structure'?['dormant','awake']:['default']){
  const data=await page.evaluate(({id,state})=>{assetReview.show(id);assetReview.setFog(false);if(state!=='default')assetReview.setState(state);return assetReview.capture();},{id:a.id,state});
  const filename=`${a.id}-${state}.png`;
  await fs.writeFile(path.join(out,filename),Buffer.from(data.split(',')[1],'base64'));
  thumbs.push({id:a.id,state,url:`/fog/images/${filename}`});
 }
}
for(const [name,width,height] of [['ariadne-title-card.png',1920,1080],['og.png',1200,630]]){
 await page.setViewportSize({width,height});
 await page.goto('http://localhost:4178/fog/review.html?capture=title',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.assetReview!==undefined);
 await page.screenshot({path:path.join(out,name)});
}
await fs.writeFile(path.join(out,'previews.json'),JSON.stringify(thumbs,null,2)+'\n');
await fs.writeFile(path.join(root,'asset-source/fog/browser-check.json'),JSON.stringify({engine:'Three.js 0.186.0',modelsLoaded:models.assets.length,previews:thumbs.length,errors},null,2)+'\n');
await browser.close();
if(errors.length)throw new Error(errors.join('\n'));
console.log(`Rendered ${thumbs.length} model previews and both title images; no browser errors.`);
