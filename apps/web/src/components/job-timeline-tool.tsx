import type { ToolCallContent, ToolCallLocation } from '@oagent/engine';
import { TerminalIcon, WrenchIcon } from 'lucide-react';
import { memo } from 'react';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import { detectLanguage } from '@/lib/detect-language';
import type { TimelinePart } from '@/lib/event-adapter';

export type JobTimelineToolProps = {
	part: Extract<TimelinePart, { kind: 'tool' }>;
};

function contentKey(content: ToolCallContent, fallbackIndex: number): string {
	if (content.type === 'diff') return `diff-${content.path}`;
	if (content.type === 'terminal') return `terminal-${content.terminalId}`;
	return `content-${fallbackIndex}`;
}

function capitalize(s: string): string {
	return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

export const JobTimelineTool = memo(function JobTimelineTool(
	props: JobTimelineToolProps,
) {
	const part = props.part;
	const icon =
		part.toolKind === 'execute' ? (
			<TerminalIcon className="size-4 text-muted-foreground" />
		) : (
			<WrenchIcon className="size-4 text-muted-foreground" />
		);
	return (
		<Tool defaultOpen={false}>
			<ToolHeader
				type="tool-invocation"
				state={part.state}
				title={capitalize(part.toolName)}
				icon={icon}
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
