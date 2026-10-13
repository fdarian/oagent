/// <reference types="bun" />
export const serveSPA = (
	filemap: Record<string, string>,
	pathname: string,
): Response | undefined => {
	const filePath = filemap[pathname] ?? filemap['/index.html'];
	if (filePath === undefined) return undefined;
	const file = Bun.file(filePath);
	return new Response(file, { headers: { 'content-type': file.type } });
};
