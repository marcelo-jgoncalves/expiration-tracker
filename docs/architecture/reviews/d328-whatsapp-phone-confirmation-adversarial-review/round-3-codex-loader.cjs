const { registerHooks } = require('node:module');
const { existsSync, readFileSync } = require('node:fs');
const { fileURLToPath } = require('node:url');
const ts = require('typescript');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.js') && specifier.startsWith('.') && context.parentURL) {
      const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(target)) return {url:target.href,shortCircuit:true};
    }
    return next(specifier,context);
  },
  load(url, context, next) {
    if(url.endsWith('.ts')) return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
    return next(url,context);
  }
});
