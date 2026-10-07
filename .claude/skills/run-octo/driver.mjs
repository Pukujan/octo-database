/**
 * Octo run/drive driver (agent tooling — not product code).
 *
 * Drives the running Octo web app in a real headless Chromium and lets an agent
 * click, type, screenshot, and read the DOM. Commands come from argv (one-shot)
 * or stdin (REPL), one per line.
 *
 *   node .claude/skills/run-octo/driver.mjs <cmd> [args...]
 *   echo -e "guest\nss login\n" | node .claude/skills/run-octo/driver.mjs
 *
 * Commands:
 *   goto <path>            navigate (default base http://localhost:3000)
 *   guest                  click "Continue as Guest" and wait for the dashboard
 *   click <text>           click the first element whose text matches
 *   clickrole <role> <name>  click by ARIA role + accessible name
 *   fill <selector> <text>  fill an input/textarea (text may contain spaces)
 *   ss [name]              screenshot -> shots/<name>.png (default: shot-N)
 *   text                   print the visible body text
 *   wait <selector>        wait for a selector to be visible
 *   sleep <ms>             pause
 *   url                    print the current URL
 *   quit                   close the browser
 *
 * Env: OCTO_BASE (default http://localhost:3000), OCTO_HEADFUL=1 to show a window.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';

const BASE = process.env.OCTO_BASE || 'http://localhost:3000';
const SHOTS = resolve(process.cwd(), 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: !process.env.OCTO_HEADFUL });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let shotN = 0;

async function run(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd) {
    case '':
      return;
    case 'goto':
      await page.goto(BASE + (arg || '/'), { waitUntil: 'networkidle' });
      console.log('url', page.url());
      return;
    case 'guest':
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.click('text=Continue as Guest');
      await page.waitForSelector('text=Workspace Control Dashboard', { timeout: 15000 });
      console.log('guest dashboard ready');
      return;
    case 'click':
      await page.click(`text=${arg}`);
      return;
    case 'clickrole': {
      // clickrole <role> <name...> [|exact]  — trailing |exact forces exact name match
      let parts = rest.slice(1);
      const exact = parts[parts.length - 1] === '|exact';
      if (exact) parts = parts.slice(0, -1);
      await page.getByRole(rest[0], { name: parts.join(' '), exact }).click();
      return;
    }
    case 'fill': {
      // fill <selector> :: <text>   — "::" separates so both sides may contain spaces
      const line = arg;
      const sep = line.indexOf(' :: ');
      if (sep === -1) {
        console.error('usage: fill <selector> :: <text>');
        return;
      }
      await page.fill(line.slice(0, sep), line.slice(sep + 4));
      return;
    }
    case 'ss': {
      const name = arg || `shot-${++shotN}`;
      const path = resolve(SHOTS, `${name}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log('screenshot', path);
      return;
    }
    case 'text':
      console.log((await page.locator('body').innerText()).trim());
      return;
    case 'wait':
      await page.waitForSelector(arg, { timeout: 15000 });
      console.log('visible', arg);
      return;
    case 'sleep':
      await page.waitForTimeout(Number(arg) || 500);
      return;
    case 'url':
      console.log(page.url());
      return;
    case 'quit':
      await browser.close();
      process.exit(0);
    default:
      console.error('unknown command:', cmd);
  }
}

const argv = process.argv.slice(2);
if (argv.length) {
  await run(argv.join(' '));
  await browser.close();
} else {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    try {
      await run(line);
    } catch (err) {
      console.error('ERR', err.message);
    }
  }
  await browser.close();
}
