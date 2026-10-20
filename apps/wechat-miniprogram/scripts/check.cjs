const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../miniprogram');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else files.push(file);
  }
}
walk(root);
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
for (const page of app.pages)
  for (const ext of ['.js', '.json', '.wxml'])
    if (!fs.existsSync(path.join(root, page + ext)))
      throw new Error('Missing page file: ' + page + ext);
for (const file of files) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file]);
  if (file.endsWith('.json')) {
    const config = JSON.parse(fs.readFileSync(file));
    for (const component of Object.values(config.usingComponents || {})) {
      const target = path.resolve(root, '.' + component);
      for (const ext of ['.js', '.json', '.wxml', '.wxss'])
        if (!fs.existsSync(target + ext)) throw new Error('Missing component: ' + target + ext);
    }
  }
  if (file.endsWith('.wxml')) {
    const content = fs.readFileSync(file, 'utf8');
    if (/<\/?(?:div|span|br|iframe|script|html)\b/i.test(content))
      throw new Error('Web-only tag in WXML: ' + file);
    const jsFile = file.replace('.wxml', '.js');
    if (fs.existsSync(jsFile)) {
      let definition;
      global.Page = (value) => {
        definition = value;
      };
      global.Component = (value) => {
        definition = value.methods;
      };
      require(jsFile);
      for (const match of content.matchAll(/\b(?:bind\w+|catch\w+)="([A-Za-z]\w*)"/g)) {
        if (!definition || typeof definition[match[1]] !== 'function')
          throw new Error('Missing event handler ' + match[1] + ': ' + file);
      }
    }
  }
}
console.log(
  `Mini program structure, JSON, JS syntax and event handlers checked (${files.length} files).`,
);
