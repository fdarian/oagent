import type { ToolCallContent, ToolCallLocation } from '@oagent/engine';
import { parseDiffFromFile } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { ChevronRightIcon, Loader2Icon, WrenchIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { detectLanguage } from '@/lib/detect-language';
import type { TimelinePart } from '@/lib/event-adapter';
import { cn } from '@/lib/utils';

type ToolPart = Extract<TimelinePart, { kind: 'tool' }>;

export type JobTimelineToolProps = {
	part: ToolPart;
	cwd: string;
};

function contentKey(content: ToolCallContent, fallbackIndex: number): string {
	if (content.type === 'diff') return `diff-${content.path}`;
	if (content.type === 'terminal') return `terminal-${content.terminalId}`;
	return `content-${fallbackIndex}`;
}

function capitalize(s: string): string {
	return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function readStringProp(value: unknown, key: string): string | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const prop = (value as Record<string, unknown>)[key];
	return typeof prop === 'string' ? prop : undefined;
}

function extractText(content: ToolCallContent[]): string {
	return content
		.map((c) =>
			c.type === 'content' && c.content.type === 'text' ? c.content.text : '',
		)
		.join('');
}

function relativePath(absPath: string, cwd: string): string {
	if (absPath === cwd) return absPath;
	const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
	return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
}

function shellDescriptor(part: ToolPart): string {
	const title = part.title;
	const meaningfulTitle =
		title.length > 0 && title.toLowerCase() !== 'bash' ? title : undefined;
	const description =
		meaningfulTitle ?? readStringProp(part.rawInput, 'description');
	if (description !== undefined && description.length > 0) return description;
	const command = readStringProp(part.rawInput, 'command');
	if (command !== undefined && command.length > 0) return command;
	return 'Shell command';
}

function readDescriptor(part: ToolPart, cwd: string): string | undefined {
	const filePath =
		readStringProp(part.rawInput, 'filePath') ??
		readStringProp(part.rawInput, 'target_file') ??
		part.locations[0]?.path;
	if (filePath !== undefined && filePath.length > 0) {
		return relativePath(filePath, cwd);
	}
	const title = part.title;
	const titleLower = title.toLowerCase();
	if (
		titleLower === 'read' ||
		titleLower === 'read file' ||
		titleLower === 'readfile'
	) {
		return undefined;
	}
	return title.length > 0 ? title : undefined;
}

type ToolRowProps = {
	label: string;
	descriptor: React.ReactNode;
	running: boolean;
	error: boolean;
	children?: React.ReactNode;
};

function ToolRow(props: ToolRowProps) {
	const descriptorClass = cn(
		'min-w-0 truncate text-sm text-muted-foreground',
		props.error && 'text-destructive',
	);

	if (props.children === undefined || props.children === null) {
		return (
			<div className="mb-2 flex w-full items-center gap-1.5 py-1">
				<span className="shrink-0 font-medium text-sm">{props.label}</span>
				{props.descriptor !== undefined && props.descriptor !== null && (
					<span className={descriptorClass}>{props.descriptor}</span>
				)}
				{props.running && (
					<Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
				)}
			</div>
		);
	}

	return (
		<Collapsible defaultOpen={false} className="group mb-2 w-full">
			<CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1 text-left">
				<span className="shrink-0 font-medium text-sm">{props.label}</span>
				{props.descriptor !== undefined && props.descriptor !== null && (
					<span className={descriptorClass}>{props.descriptor}</span>
				)}
				{props.running && (
					<Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
				)}
				<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-data-[state=open]:rotate-90 group-data-[state=open]:opacity-100" />
			</CollapsibleTrigger>
			<CollapsibleContent className="pt-2">{props.children}</CollapsibleContent>
		</Collapsible>
	);
}

export const JobTimelineTool = memo(function JobTimelineTool(
	props: JobTimelineToolProps,
) {
	const part = props.part;
	const isRunning =
		part.state === 'input-available' || part.state === 'input-streaming';
	const isError = part.state === 'output-error';

	if (part.toolKind === 'execute') {
		const descriptor = shellDescriptor(part);
		const command = readStringProp(part.rawInput, 'command');
		const output = extractText(part.content);
		const children =
			command !== undefined || output.length > 0 ? (
				<ShellOutput part={part} />
			) : null;
		return (
			<ToolRow
				label="Shell"
				descriptor={descriptor}
				running={isRunning}
				error={isError}
			>
				{children}
			</ToolRow>
		);
	}

	if (part.toolKind === 'read') {
		const descriptor = readDescriptor(part, props.cwd);
		const children =
			part.content.length > 0 ? <ReadOutput part={part} /> : null;
		return (
			<ToolRow
				label="Read"
				descriptor={descriptor}
				running={isRunning}
				error={isError}
			>
				{children}
			</ToolRow>
		);
	}

	if (part.toolKind === 'edit') {
		if (isWrite(part)) {
			return <WriteRow part={part} cwd={props.cwd} />;
		}
		return <EditRow part={part} cwd={props.cwd} />;
	}

	if (part.toolKind === 'delete') {
		return (
			<DeleteRow
				part={part}
				cwd={props.cwd}
				running={isRunning}
				error={isError}
			/>
		);
	}

	if (part.toolKind === 'search') {
		return <SearchRow part={part} running={isRunning} error={isError} />;
	}

	if (readStringProp(part.rawInput, 'variant') === 'ListDir') {
		return <ListRow part={part} running={isRunning} error={isError} />;
	}

	return (
		<Tool defaultOpen={false}>
			<ToolHeader
				type="tool-invocation"
				state={part.state}
				title={capitalize(part.toolName)}
				icon={<WrenchIcon className="size-4 text-muted-foreground" />}
			/>
			<ToolContent>
				{part.content.map((c, i) => (
					<ToolCallContentBlock key={contentKey(c, i)} content={c} />
				))}
				{part.locations.length > 0 && (
					<ToolLocations locations={part.locations} />
				)}
			</ToolContent>
		</Tool>
	);
});

function isWrite(part: ToolPart): boolean {
	const variant = readStringProp(part.rawInput, 'variant');
	if (variant === 'Write') return true;

	const diffEntry = part.content.find((c) => c.type === 'diff');

	// opencode: has content field, no oldString/old_string, no diff
	if (
		readStringProp(part.rawInput, 'content') !== undefined &&
		readStringProp(part.rawInput, 'oldString') === undefined &&
		readStringProp(part.rawInput, 'old_string') === undefined &&
		diffEntry === undefined
	) {
		return true;
	}

	// cursor / general: diff present with empty or /dev/null old side
	if (diffEntry !== undefined && diffEntry.type === 'diff') {
		const oldText = diffEntry.oldText ?? '';
		if (oldText === '' || /^-- \/dev\/null/.test(oldText)) return true;
	}

	return false;
}

function writeBody(part: ToolPart): string | undefined {
	const contentProp = readStringProp(part.rawInput, 'content');
	if (contentProp !== undefined) return contentProp;

	const diffEntry = part.content.find((c) => c.type === 'diff');
	if (diffEntry === undefined || diffEntry.type !== 'diff') return undefined;

	const raw = diffEntry.newText;
	// cursor pollutes with a `++ b/<path>` header on the first line — strip it
	if (raw.startsWith('++ ')) {
		const newlineIdx = raw.indexOf('\n');
		return newlineIdx >= 0 ? raw.slice(newlineIdx + 1) : '';
	}
	return raw;
}

function writePath(part: ToolPart): string | undefined {
	return (
		readStringProp(part.rawInput, 'filePath') ??
		readStringProp(part.rawInput, 'file_path') ??
		part.content.find((c) => c.type === 'diff')?.path ??
		part.locations[0]?.path
	);
}

function splitRelativePath(rel: string): { basename: string; dir: string } {
	const lastSlash = rel.lastIndexOf('/');
	return {
		basename: lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel,
		dir: lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : '',
	};
}

function readRawOutputString(
	rawOutput: unknown,
	...keys: string[]
): string | undefined {
	let cursor: unknown = rawOutput;
	for (const key of keys) {
		if (typeof cursor !== 'object' || cursor === null) return undefined;
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return typeof cursor === 'string' ? cursor : undefined;
}

function WriteRow(props: { part: ToolPart; cwd: string }) {
	const part = props.part;
	const isRunning =
		part.state === 'input-available' || part.state === 'input-streaming';
	const isError = part.state === 'output-error';

	const rawPath = writePath(part);
	const body = writeBody(part);

	const descriptor = (() => {
		if (rawPath === undefined || rawPath.length === 0) return undefined;
		const rel = relativePath(rawPath, props.cwd);
		const { basename, dir } = splitRelativePath(rel);
		return (
			<span className="flex min-w-0 items-baseline gap-1.5">
				<span className="font-medium text-foreground">{basename}</span>
				{dir.length > 0 && (
					<span className="min-w-0 truncate text-muted-foreground">{dir}</span>
				)}
			</span>
		);
	})();

	const children =
		body !== undefined && body.length > 0 ? (
			<div className="overflow-hidden rounded-md border">
				<CodeBlock code={body} language={detectLanguage(body)} />
			</div>
		) : null;

	return (
		<ToolRow
			label="Write"
			descriptor={descriptor}
			running={isRunning}
			error={isError}
		>
			{children}
		</ToolRow>
	);
}

function DeleteRow(props: {
	part: ToolPart;
	cwd: string;
	running: boolean;
	error: boolean;
}) {
	const part = props.part;
	const diffEntry = part.content.find((c) => c.type === 'diff');
	const rawPath =
		diffEntry?.path ??
		part.locations[0]?.path ??
		readStringProp(part.rawInput, 'filePath') ??
		readStringProp(part.rawInput, 'path') ??
		readStringProp(part.rawInput, 'file_path');

	const descriptor =
		rawPath !== undefined && rawPath.length > 0
			? relativePath(rawPath, props.cwd)
			: undefined;

	return (
		<ToolRow
			label="Delete"
			descriptor={descriptor}
			running={props.running}
			error={props.error}
		/>
	);
}

function ListRow(props: { part: ToolPart; running: boolean; error: boolean }) {
	const part = props.part;

	const descriptor =
		readStringProp(part.rawInput, 'target_directory') ??
		part.locations[0]?.path ??
		'.';

	const listingText = readRawOutputString(part.rawOutput, 'Content', 'content');

	const children =
		listingText !== undefined && listingText.length > 0 ? (
			<div className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
				{listingText}
			</div>
		) : null;

	return (
		<ToolRow
			label="List"
			descriptor={descriptor}
			running={props.running}
			error={props.error}
		>
			{children}
		</ToolRow>
	);
}

function EditRow(props: { part: ToolPart; cwd: string }) {
	const part = props.part;
	const isRunning =
		part.state === 'input-available' || part.state === 'input-streaming';
	const isError = part.state === 'output-error';

	const diffEntry = part.content.find((c) => c.type === 'diff');

	if (diffEntry === undefined || diffEntry.type !== 'diff') {
		const rawPath =
			part.locations[0]?.path ??
			readStringProp(part.rawInput, 'filePath') ??
			readStringProp(part.rawInput, 'path');
		const descriptor =
			rawPath !== undefined && rawPath.length > 0
				? relativePath(rawPath, props.cwd)
				: 'file';
		return (
			<ToolRow
				label="Edit"
				descriptor={descriptor}
				running={isRunning}
				error={isError}
			/>
		);
	}

	return (
		<EditDiffRow
			diffPath={diffEntry.path}
			oldText={diffEntry.oldText ?? ''}
			newText={diffEntry.newText}
			cwd={props.cwd}
			running={isRunning}
			error={isError}
		/>
	);
}

type EditDiffRowProps = {
	diffPath: string;
	oldText: string;
	newText: string;
	cwd: string;
	running: boolean;
	error: boolean;
};

function EditDiffRow(props: EditDiffRowProps) {
	const fileDiff = useMemo(
		() =>
			parseDiffFromFile(
				{ name: props.diffPath, contents: props.oldText },
				{ name: props.diffPath, contents: props.newText },
			),
		[props.diffPath, props.oldText, props.newText],
	);

	const added = fileDiff.hunks.reduce((s, h) => s + h.additionLines, 0);
	const removed = fileDiff.hunks.reduce((s, h) => s + h.deletionLines, 0);

	const rel = relativePath(props.diffPath, props.cwd);
	const lastSlash = rel.lastIndexOf('/');
	const basename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
	const dir = lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : '';

	const descriptor = (
		<span className="flex min-w-0 items-baseline gap-1.5">
			<span className="font-medium text-foreground">{basename}</span>
			{dir.length > 0 && (
				<span className="min-w-0 truncate text-muted-foreground">{dir}</span>
			)}
			<span className="shrink-0 text-emerald-600 dark:text-emerald-400">
				+{added}
			</span>
			<span className="shrink-0 text-red-600 dark:text-red-400">
				&minus;{removed}
			</span>
		</span>
	);

	return (
		<ToolRow
			label="Edit"
			descriptor={descriptor}
			running={props.running}
			error={props.error}
		>
			<div className="overflow-hidden rounded-md border">
				<FileDiff
					fileDiff={fileDiff}
					options={{
						diffStyle: 'unified',
						diffIndicators: 'bars',
						theme: { light: 'github-light', dark: 'github-dark' },
						themeType: 'system',
					}}
				/>
			</div>
		</ToolRow>
	);
}

function SearchRow(props: {
	part: ToolPart;
	running: boolean;
	error: boolean;
}) {
	const part = props.part;
	const label = /glob/i.test(part.title) ? 'Glob' : 'Grep';

	const pattern =
		readStringProp(part.rawInput, 'pattern') ??
		readStringProp(part.rawInput, 'glob_pattern');
	const include = readStringProp(part.rawInput, 'include');

	let descriptorText = '';
	if (pattern !== undefined) {
		descriptorText = `pattern="${pattern}"`;
	}
	if (include !== undefined) {
		descriptorText =
			descriptorText.length > 0
				? `${descriptorText} include=${include}`
				: `include=${include}`;
	}
	if (descriptorText.length === 0) {
		descriptorText = 'search';
	}

	const descriptor = (
		<>
			<span className="text-muted-foreground/60">/</span>{' '}
			<span className="min-w-0 truncate">{descriptorText}</span>
		</>
	);

	const output = extractText(part.content);
	const children =
		output.length > 0 ? (
			<div className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
				{output}
			</div>
		) : null;

	return (
		<ToolRow
			label={label}
			descriptor={descriptor}
			running={props.running}
			error={props.error}
		>
			{children}
		</ToolRow>
	);
}

function ShellOutput(props: { part: ToolPart }) {
	const command = readStringProp(props.part.rawInput, 'command');
	const output = extractText(props.part.content);
	if (command === undefined && output.length === 0) return null;
	return (
		<div className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
			{command !== undefined && (
				<div className="whitespace-pre-wrap">$ {command}</div>
			)}
			{output.length > 0 && (
				<div
					className={cn(
						'whitespace-pre-wrap text-muted-foreground',
						command !== undefined && 'mt-3',
					)}
				>
					{output}
				</div>
			)}
		</div>
	);
}

function ReadOutput(props: { part: ToolPart }) {
	if (props.part.content.length === 0) {
		return <div className="text-xs text-muted-foreground">No content</div>;
	}
	return (
		<>
			{props.part.content.map((c, i) => (
				<ToolCallContentBlock key={contentKey(c, i)} content={c} />
			))}
		</>
	);
}

function ToolCallContentBlock(props: { content: ToolCallContent }) {
	const content = props.content;
	if (content.type === 'content') {
		if (content.content.type === 'text') {
			return (
				<CodeBlock
					code={content.content.text}
					language={detectLanguage(content.content.text)}
				/>
			);
		}
		return (
			<div className="text-xs text-muted-foreground">
				[{content.content.type}]
			</div>
		);
	}
	if (content.type === 'diff') {
		return (
			<div className="space-y-1">
				<div className="text-xs font-mono text-muted-foreground">
					{content.path}
				</div>
				{content.oldText !== undefined && content.oldText !== null && (
					<pre className="text-xs text-destructive whitespace-pre-wrap">
						{content.oldText}
					</pre>
				)}
				<pre className="text-xs whitespace-pre-wrap">{content.newText}</pre>
			</div>
		);
	}
	if (content.type === 'terminal') {
		return (
			<div className="text-xs text-muted-foreground">
				[terminal {content.terminalId}]
			</div>
		);
	}
	return null;
}

function ToolLocations(props: { locations: ToolCallLocation[] }) {
	return (
		<div className="space-y-0.5">
			{props.locations.map((loc) => (
				<div
					key={`${loc.path}:${loc.line ?? ''}`}
					className="text-xs font-mono text-muted-foreground"
				>
					{loc.path}
					{typeof loc.line === 'number' && `:${loc.line}`}
				</div>
			))}
		</div>
	);
}
