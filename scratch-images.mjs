import puppeteer from 'puppeteer'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const routes = ['#/', '#/about', '#/boarding', '#/pickup', '#/fees', '#/hours', '#/vaccinations', '#/why', '#/faq', '#/gallery', '#/testimonials', '#/contact', '#/terms', '#/privacy']
const idx = pathToFileURL(path.resolve('index.html')).href
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.goto(idx, { waitUntil: 'networkidle0', timeout: 60000 })

const ids = new Map() // id -> a sample full url seen
function addUrl(u) {
  const m = /static\.wixstatic\.com\/media\/([^/"')\s]+)/.exec(u)
  if (m) { const id = m[1]; if (!ids.has(id)) ids.set(id, u) }
}
for (const h of routes) {
  await page.evaluate((x) => { location.hash = x }, h)
  await new Promise((r) => setTimeout(r, 900))
  const found = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('img').forEach((i) => { if (i.src) out.push(i.src); if (i.currentSrc) out.push(i.currentSrc) })
    // background images
    document.querySelectorAll('*').forEach((el) => {
      const bg = getComputedStyle(el).backgroundImage
      if (bg && bg.includes('wixstatic')) out.push(bg)
    })
    return out
  })
  found.forEach(addUrl)
  console.log(`${h.padEnd(15)} running total ids: ${ids.size}`)
}
await browser.close()

// include og:image from seo-head.html
const seo = fs.readFileSync('seo-head.html', 'utf8')
for (const m of seo.matchAll(/static\.wixstatic\.com\/media\/([^/"')\s]+)/g)) if (!ids.has(m[1])) ids.set(m[1], m[0])

const list = [...ids.keys()].sort()
fs.writeFileSync('scratch-image-ids.json', JSON.stringify(list, null, 2))
console.log(`\nTOTAL UNIQUE IMAGE IDS: ${list.length}`)
list.forEach((id) => console.log('  ' + id))
