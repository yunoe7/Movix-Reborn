import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

// Le build Vite transpile le JSX sans contrôle de type : un composant utilisé
// sans import compile puis provoque `Can't find variable` à l'exécution.
// Ce test vérifie sémantiquement que le `<ConfirmDialog />` de CommentsSection
// est lié au composant partagé, et pas seulement qu'une chaîne est présente.
const COMMENTS = 'src/components/CommentsSection.tsx';
const SHARED_DIALOG = 'src/components/ui/confirm-dialog.tsx';

function analyzeCommentsSection() {
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
    baseUrl: '.',
    paths: { '@/*': ['src/*'] },
  };
  const program = ts.createProgram([COMMENTS], options);
  const source = program.getSourceFile(COMMENTS);
  assert.ok(source, `${COMMENTS} doit être analysable`);
  const checker = program.getTypeChecker();

  const usages: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && ts.isIdentifier(node.tagName)
      && node.tagName.text === 'ConfirmDialog') {
      usages.push(node.tagName);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const unresolved = program.getSemanticDiagnostics(source).filter(diagnostic => (
    diagnostic.code === 2304 && String(diagnostic.messageText).includes('ConfirmDialog')
  ));

  let symbol = usages.length ? checker.getSymbolAtLocation(usages[0]) : undefined;
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);

  return {
    usages,
    unresolved,
    declarations: symbol?.declarations?.map(declaration => (
      declaration.getSourceFile().fileName.replace(/\\/g, '/')
    )) ?? [],
  };
}

test('ConfirmDialog utilisé dans CommentsSection est lié au composant partagé', () => {
  const { usages, unresolved, declarations } = analyzeCommentsSection();
  assert.ok(usages.length > 0, 'la confirmation de suppression doit rester présente');
  assert.deepEqual(
    unresolved.map(diagnostic => String(diagnostic.messageText)),
    [],
    'ConfirmDialog ne doit pas être un identifiant non résolu (ReferenceError à l’exécution)',
  );
  assert.ok(
    declarations.some(file => file.endsWith(SHARED_DIALOG)),
    `ConfirmDialog doit être importé depuis ${SHARED_DIALOG}, déclarations : ${declarations.join(', ') || 'aucune'}`,
  );
});
