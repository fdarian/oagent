import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import {
	createSideChatTimeline,
	type SideChat,
} from '@/lib/side-chat-timeline.ts';
import { SideChatDrawer, type SideChatDrawerProps } from './side-chat-drawer';

const initialSideChats: SideChat[] = [
	{
		id: 'chat-1',
		createdAt: 1_700_000_000_000,
		turns: [
			{
				id: 'turn-1',
				status: 'done',
				createdAt: 1_700_000_000_000,
				terminatedAt: 1_700_000_001_000,
				prompt: 'Summarize the authentication changes.',
				events: [],
			},
		],
	},
	{
		id: 'chat-2',
		createdAt: 1_700_000_100_000,
		turns: [
			{
				id: 'turn-2',
				status: 'done',
				createdAt: 1_700_000_100_000,
				terminatedAt: 1_700_000_101_000,
				prompt: 'What tests cover this flow?',
				events: [],
			},
		],
	},
];

const scrollableSideChats: SideChat[] = [
	{
		id: 'chat-scrollable',
		createdAt: 1_700_001_000_000,
		turns: Array.from({ length: 100 }, (_value, index) => ({
			id: `turn-${index}`,
			status: 'done',
			createdAt: 1_700_001_000_000 + index * 1_000,
			terminatedAt: 1_700_001_000_500 + index * 1_000,
			prompt: `Message ${index + 1}`,
			events: [],
		})),
	},
];

function ExistingChatsPreview(props: { initialSideChats: SideChat[] }) {
	const firstSideChat = props.initialSideChats[0];
	if (firstSideChat === undefined) {
		throw new Error('Expected at least one side chat');
	}
	const [open, setOpen] = useState(true);
	const [sideChats, setSideChats] = useState(props.initialSideChats);
	const [selectedSideChatId, setSelectedSideChatId] = useState(
		firstSideChat.id,
	);
	const reopenButtonRef = useRef<HTMLButtonElement>(null);
	const selectedSideChat = sideChats.find(
		(sideChat) => sideChat.id === selectedSideChatId,
	);
	const timeline =
		selectedSideChat === undefined
			? undefined
			: createSideChatTimeline(selectedSideChat, undefined);

	const handleCreate = () => {
		const sideChatId = crypto.randomUUID();
		setSideChats((previous) => [
			...previous,
			{
				id: sideChatId,
				createdAt: Date.now(),
				turns: [],
			},
		]);
		setSelectedSideChatId(sideChatId);
	};

	const handleSend = async (prompt: string) => {
		const sideChatId = selectedSideChatId;
		if (sideChatId === undefined) {
			throw new Error('Select a side chat before sending a message.');
		}
		const now = Date.now();
		setSideChats((previous) =>
			previous.map((sideChat) =>
				sideChat.id === sideChatId
					? {
							...sideChat,
							turns: [
								...sideChat.turns,
								{
									id: crypto.randomUUID(),
									status: 'done',
									createdAt: now,
									terminatedAt: now,
									prompt,
									events: [],
								},
							],
						}
					: sideChat,
			),
		);
	};

	return (
		<div className="p-22">
			<button
				ref={reopenButtonRef}
				type="button"
				onClick={() => setOpen(true)}
				className="border border-border px-3 py-2 text-caption text-muted-foreground"
			>
				Open side chats
			</button>
			<SideChatDrawer
				open={open}
				onOpenChange={setOpen}
				onCloseAutoFocus={() => reopenButtonRef.current?.focus()}
				cwd="/Users/dev/project"
				sideChats={sideChats}
				selectedSideChatId={selectedSideChatId}
				onSelectSideChat={setSelectedSideChatId}
				onCreate={handleCreate}
				isCreating={false}
				isLoading={false}
				timeline={timeline}
				onSend={handleSend}
				onSubmitError={() => {}}
				isSending={false}
			/>
		</div>
	);
}

const meta = {
	component: SideChatDrawer,
	parameters: {
		layout: 'fullscreen',
	},
} satisfies Meta<typeof SideChatDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

const storyArgs = {
	open: true,
	onOpenChange: () => {},
	cwd: '/Users/dev/project',
	sideChats: initialSideChats,
	selectedSideChatId: 'chat-1',
	onSelectSideChat: () => {},
	onCreate: () => {},
	isCreating: false,
	isLoading: false,
	timeline: createSideChatTimeline(initialSideChats[0], undefined),
	onSend: async () => {},
	onSubmitError: () => {},
	isSending: false,
} satisfies SideChatDrawerProps;

export const ExistingChats: Story = {
	args: storyArgs,
	render: () => <ExistingChatsPreview initialSideChats={initialSideChats} />,
};

export const ScrollableTimeline: Story = {
	args: storyArgs,
	render: () => <ExistingChatsPreview initialSideChats={scrollableSideChats} />,
};
