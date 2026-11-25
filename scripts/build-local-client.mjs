import {readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  require = createRequire(import.meta.url);
function findCompiler() {
  if (process.argv[2]) return process.argv[2];
  try {
    return require.resolve('typescript');
  } catch {
    /* ikke installeret her; prøv næste placering */
  }
  const base = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code');
  const candidates = [
    base,
    ...(existsSync(base)
      ? readdirSync(base, {withFileTypes: true})
          .filter((x) => x.isDirectory())
          .map((x) => path.join(base, x.name))
      : []),
  ];
  for (const candidate of candidates) {
    const p = path.join(
      candidate,
      'resources/app/extensions/node_modules/typescript/lib/typescript.js',
    );
    if (existsSync(p)) return p;
  }
  throw new Error(
    'TypeScript blev ikke fundet. Angiv stien til typescript.js som første argument.',
  );
}
const ts = require(findCompiler()),
  out = path.join(root, 'public');
mkdirSync(out, {recursive: true});
const definitions = [];
function add(id, code) {
  definitions.push(`${JSON.stringify(id)}:function(module,exports,require){\n${code}\n}`);
}
const vendors = [
  ['react', 'react', 'react.production.js'],
  ['react/jsx-runtime', 'react', 'react-jsx-runtime.production.js'],
  ['react-dom', 'react-dom', 'react-dom.production.js'],
  ['react-dom/client', 'react-dom', 'react-dom-client.production.js'],
  ['scheduler', 'scheduler', 'scheduler.production.js'],
];
for (const [id, pkg, file] of vendors)
  add(id, readFileSync(path.join(root, 'node_modules', pkg, 'cjs', file), 'utf8'));
const sources = [
  ...readdirSync(path.join(root, 'src/client'))
    .filter((f) => /\.tsx?$/.test(f) && f !== 'icons.tsx')
    .map((f) => ({id: 'ui/' + f.replace(/\.tsx?$/, ''), file: path.join(root, 'src/client', f)})),
  ...readdirSync(path.join(root, 'src/shared'))
    .filter((f) => /.ts$/.test(f))
    .map((f) => ({id: 'shared/' + f.replace(/.ts$/, ''), file: path.join(root, 'src/shared', f)})),
  {id: 'lucide-react', file: path.join(root, 'src/client/icons.tsx')},
];
let errors = 0;
for (const {id, file} of sources) {
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
    },
  });
  for (const d of result.diagnostics || []) {
    console.error(ts.flattenDiagnosticMessageText(d.messageText, ' '));
    errors++;
  }
  add(id, result.outputText);
}
if (errors) throw new Error('Ret syntaksfejlene før den lokale klient bygges.');
const runtime = `/* Roboref local client. React/ReactDOM/Scheduler are MIT licensed; see THIRD-PARTY-LICENSES.txt. */\n(function(){'use strict';\nconst modules={${definitions.join(',\n')}};\nconst cache=Object.create(null);\nfunction load(id,from=''){if(id.startsWith('.')){const parts=from.split('/');parts.pop();for(const part of id.split('/')){if(part==='.')continue;if(part==='..')parts.pop();else parts.push(part);}id=parts.join('/');}if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('Ukendt klientmodul: '+id);const module={exports:{}};cache[id]=module;modules[id](module,module.exports,name=>load(name,id));return module.exports;}\nconst React=load('react');const Dashboard=load('ui/dashboard').default;load('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Dashboard,{user:{name:globalThis.__ROBOREF_USER__?.name||'Lokal bruger',email:'Gemmes på denne computer'},initialData:globalThis.__ROBOREF_INITIAL__||undefined}));\n})();\n`;
writeFileSync(path.join(out, 'client.js'), runtime);
writeFileSync(
  path.join(out, 'app.css'),
  readFileSync(path.join(root, 'src/client/styles.css'), 'utf8').replace(
    /^@import 'tailwindcss';/,
    '',
  ),
);
writeFileSync(
  path.join(out, 'THIRD-PARTY-LICENSES.txt'),
  ['react', 'react-dom', 'scheduler']
    .map(
      (name) =>
        `${name}\n${readFileSync(path.join(root, 'node_modules', name, 'LICENSE'), 'utf8')}`,
    )
    .join('\n\n'),
);
console.log(
  JSON.stringify({
    built: true,
    sourceModules: sources.length,
    bundleBytes: Buffer.byteLength(runtime),
    offline: true,
  }),
);
