import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type Preset = { id: string; name: string };

export function AliasPresetCombobox(props: {
	presets: Preset[];
	active: Preset | null;
	disabled: boolean;
	onCreate: (name: string) => void;
	onActivate: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const name = search.trim();
	const showCreate = !props.presets.some((preset) => preset.name === name);
	return (
		<Popover
			open={open}
			onOpenChange={(value) => {
				setOpen(value);
				if (!value) setSearch('');
			}}
			modal
		>
			<PopoverTrigger
				render={
					<Button
						variant="outline"
						role="combobox"
						aria-label="Alias preset"
						aria-expanded={open}
						disabled={props.disabled}
					>
						{props.active === null ? 'No preset' : props.active.name}
						<ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
					</Button>
				}
			/>
			<PopoverContent className="w-64 p-0">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search or create preset…"
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList>
						<CommandGroup>
							{props.presets
								.filter((preset) =>
									preset.name.toLowerCase().includes(name.toLowerCase()),
								)
								.map((preset) => (
									<CommandItem
										key={preset.id}
										value={preset.id}
										onSelect={() => {
											if (preset.id !== props.active?.id)
												props.onActivate(preset.id);
											setOpen(false);
											setSearch('');
										}}
									>
										<Check
											className={cn(
												'mr-2 h-4 w-4',
												preset.id === props.active?.id
													? 'opacity-100'
													: 'opacity-0',
											)}
										/>
										{preset.name}
									</CommandItem>
								))}
							{showCreate && (
								<CommandItem
									value={`new:${name}`}
									disabled={name.length === 0}
									onSelect={() => {
										props.onCreate(name);
										setOpen(false);
										setSearch('');
									}}
								>
									{name.length === 0 ? (
										<span>
											New preset "
											<span className="text-muted-foreground">Type name…</span>"
										</span>
									) : (
										`New preset "${name}"`
									)}
								</CommandItem>
							)}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
