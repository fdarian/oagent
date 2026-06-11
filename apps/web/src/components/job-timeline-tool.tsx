import type { ToolCallContent, ToolCallLocation } from '@oagent/engine';
import { ChevronRightIcon, Loader2Icon, WrenchIcon } from 'lucide-react';
import { memo } from 'react';
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

function readDescriptor(part: ToolPart, cwd: string): string {
	const filePath =
		readStringProp(part.rawInput, 'filePath') ?? part.locations[0]?.path;
	if (filePath !== undefined && filePath.length > 0) {
		return relativePath(filePath, cwd);
	}
	const title = part.title;
	return title.length > 0 && title.toLowerCase() !== 'read' ? title : 'file';
}

export const JobTimelineTool = memo(function JobTimelineTool(
	props: JobTimelineToolProps,
) {
	const part = props.part;
	if (part.toolKind === 'execute' || part.toolKind === 'read') {
		return <MinimalToolRow part={part} cwd={props.cwd} />;
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

function MinimalToolRow(props: { part: ToolPart; cwd: string }) {
	const part = props.part;
	const isShell = part.toolKind === 'execute';
	const label = isShell ? 'Shell' : 'Read';
	const descriptor = isShell
		? shellDescriptor(part)
		: readDescriptor(part, props.cwd);
	const isRunning =
		part.state === 'input-available' || part.state === 'input-streaming';
	const isError = part.state === 'output-error';
	return (
		<Collapsible defaultOpen={false} className="group mb-2 w-full">
			<CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1 text-left">
				<span className="shrink-0 font-medium text-sm">{label}</span>
				<span
					className={cn(
						'min-w-0 truncate text-sm text-muted-foreground',
						isError && 'text-destructive',
					)}
				>
					{descriptor}
				</span>
				{isRunning && (
					<Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
				)}
				<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-data-[state=open]:rotate-90 group-data-[state=open]:opacity-100" />
			</CollapsibleTrigger>
			<CollapsibleContent className="pt-2">
				{isShell ? <ShellOutput part={part} /> : <ReadOutput part={part} />}
			</CollapsibleContent>
		</Collapsible>
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
