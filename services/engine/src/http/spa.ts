/// <reference types="bun" />
export const serveSPA = (filemap: Record<string, string>, pathname: string): Response | undefined => {
  const filePath = filemap[pathname] ?? filemap['/index.html']
  if (filePath === undefined) return undefined
  return new Response(Bun.file(filePath))
}
