from pathlib import Path

path = Path('packages/domain/src/exact-operation-handlers.ts')
text = path.read_text(encoding='utf-8')
old = "  const suppliedSourceDigest = digestArgument(context, 'sourceDigest');"
new = (
    "  if (typeof context.arguments.sourceDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/iu.test(context.arguments.sourceDigest)) "
    "throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'sourceDigest must be a sha256 digest', 422, 'DO_NOT_RETRY', { key: 'sourceDigest' });\n"
    "  const suppliedSourceDigest = digestArgument(context, 'sourceDigest', {});"
)
if old not in text:
    raise SystemExit('sourceDigest call marker not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('batch3 mandatory sourceDigest guard applied')
