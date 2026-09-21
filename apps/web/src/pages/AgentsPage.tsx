import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { type Backend, HARNESS_NAMES } from '@/lib/harnesses';
import { orpc } from '@/lib/orpc';
import { queryKeys } from '@/lib/query-keys';

type Agent = Awaited<ReturnType<typeof orpc.agents.list>>[number];
type AgentTarget = Agent['targets'][number];
type AgentTargetOption = Awaited<
	ReturnType<typeof orpc.agents.targets>
>[number];

type AgentFormValues = {
	name: string;
	opencodeTarget: string;
	cursorTarget: string;
	grokTarget: string;
	codexTarget: string;
};

type AgentFormProps = {
	editingAgent: Agent | undefined;
	onSuccess: () => void;
	onCancel: () => void;
};

type OpenCodeTargetSelectProps = {
	value: string;
	onChange: (value: string) => void;
};

type UnsupportedTargetFieldProps = {
	backend: Exclude<Backend, 'opencode'>;
	value: string;
};

function getTarget(agent: Agent | undefined, backend: Backend): string {
	if (agent === undefined) return '';
	const target = agent.targets.find((entry) => entry.backend === backend);
	return target === undefined ? '' : target.target;
}

function addTarget(
	targets: Array<AgentTarget>,
	backend: Backend,
	value: string,
) {
	const target = value.trim();
	if (target === '') return;
	targets.push({ backend, target });
}

function getFormTargets(values: AgentFormValues): Array<AgentTarget> {
	const targets: Array<AgentTarget> = [];
	addTarget(targets, 'opencode', values.opencodeTarget);
	addTarget(targets, 'cursor', values.cursorTarget);
	addTarget(targets, 'grok', values.grokTarget);
	addTarget(targets, 'codex', values.codexTarget);
	return targets;
}

function hasDistinctTargetId(target: AgentTargetOption): boolean {
	return target.label.toLowerCase() !== target.id.toLowerCase();
}

function getTargetLabel(
	target: AgentTargetOption | undefined,
	value: string,
): string | undefined {
	if (value === '') return undefined;
	if (target === undefined) return value;
	if (!hasDistinctTargetId(target)) return target.label;
	return `${target.label} (${target.id})`;
}

function OpenCodeTargetSelect(props: OpenCodeTargetSelectProps) {
	const expandedTargetIdState = useState<string>();
	const expandedTargetId = expandedTargetIdState[0];
	const setExpandedTargetId = expandedTargetIdState[1];
	const targetsQuery = useQuery({
		queryKey: queryKeys.agentTargets('opencode'),
		queryFn: () => orpc.agents.targets({ backend: 'opencode' }),
		staleTime: 5 * 60 * 1000,
	});
	const targets = targetsQuery.data;
	const selectedTarget = targets?.find((target) => target.id === props.value);
	const selectedLabel = getTargetLabel(selectedTarget, props.value);
	const selectedTargetIsUnavailable =
		props.value !== '' && targets !== undefined && selectedTarget === undefined;
	const placeholder = targetsQuery.isPending
		? 'Loading OpenCode agents…'
		: targetsQuery.isError
			? 'OpenCode agents unavailable'
			: targets !== undefined && targets.length === 0
				? 'No OpenCode agents found'
				: 'Select an OpenCode agent';

	return (
		<Field className="min-w-0">
			<FieldLabel htmlFor="agent-target-opencode">OpenCode</FieldLabel>
			<div className="flex items-center gap-2">
				<Select
					value={props.value}
					disabled={targets === undefined}
					onValueChange={props.onChange}
				>
					<SelectTrigger id="agent-target-opencode" className="w-full">
						<SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
					</SelectTrigger>
					<SelectContent
						position="popper"
						className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]"
					>
						{selectedTargetIsUnavailable ? (
							<SelectItem value={props.value}>
								<span className="flex w-full min-w-0 flex-col overflow-hidden">
									<span className="font-mono">{props.value}</span>
									<span className="text-xs text-muted-foreground">
										Currently unavailable
									</span>
								</span>
							</SelectItem>
						) : null}
						{targets?.map((target) => (
							<SelectItem key={target.id} value={target.id}>
								<span className="flex w-full min-w-0 flex-col overflow-hidden">
									<span>{target.label}</span>
									{hasDistinctTargetId(target) ? (
										<span className="font-mono text-xs text-muted-foreground">
											{target.id}
										</span>
									) : null}
									{target.description !== undefined ? (
										<span className="block w-full min-w-0 max-w-full truncate pr-6 text-xs text-muted-foreground">
											{target.description}
										</span>
									) : null}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{props.value !== '' ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => props.onChange('')}
					>
						Clear
					</Button>
				) : null}
			</div>
			{targetsQuery.isError ? (
				<div className="flex items-center gap-2">
					<FieldError>
						Could not discover OpenCode agents: {targetsQuery.error.message}
					</FieldError>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => targetsQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : targets !== undefined && targets.length === 0 ? (
				<FieldDescription>
					No selectable agents were reported by OpenCode.
				</FieldDescription>
			) : selectedTargetIsUnavailable ? (
				<FieldDescription>
					This saved target is not currently reported by OpenCode. It will be
					preserved unless you clear or replace it.
				</FieldDescription>
			) : selectedTarget?.description !== undefined ? (
				<div className="w-full min-w-0 max-w-full">
					<FieldDescription
						className={
							expandedTargetId === selectedTarget.id
								? 'w-full break-words whitespace-normal'
								: 'w-full truncate'
						}
					>
						{selectedTarget.description}
					</FieldDescription>
					<Button
						type="button"
						variant="link"
						size="xs"
						className="h-auto shrink-0 px-0 py-0"
						onClick={() =>
							setExpandedTargetId(
								expandedTargetId === selectedTarget.id
									? undefined
									: selectedTarget.id,
							)
						}
					>
						{expandedTargetId === selectedTarget.id ? 'Show less' : 'Show more'}
					</Button>
				</div>
			) : (
				<FieldDescription>
					Choose the OpenCode agent used for this agent type.
				</FieldDescription>
			)}
		</Field>
	);
}

function UnsupportedTargetField(props: UnsupportedTargetFieldProps) {
	const inputId = `agent-target-${props.backend}`;
	const hasExistingTarget = props.value !== '';
	return (
		<Field>
			<FieldLabel htmlFor={inputId}>{HARNESS_NAMES[props.backend]}</FieldLabel>
			<Input
				id={inputId}
				value={props.value}
				placeholder="Not supported yet"
				disabled
				className="font-mono"
			/>
			<FieldDescription>
				{hasExistingTarget
					? 'This existing target will be preserved, but editing it is not supported yet.'
					: 'Agent mapping is not supported yet.'}
			</FieldDescription>
		</Field>
	);
}

function AgentForm(props: AgentFormProps) {
	const queryClient = useQueryClient();
	const [saveError, setSaveError] = useState<string | undefined>();
	const saveMutation = useMutation({
		mutationFn: (input: { name: string; targets: Array<AgentTarget> }) =>
			orpc.agents.save(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
			props.onSuccess();
		},
		onError: (error: Error) => {
			setSaveError(error.message);
		},
	});
	const form = useForm({
		defaultValues: {
			name: props.editingAgent === undefined ? '' : props.editingAgent.name,
			opencodeTarget: getTarget(props.editingAgent, 'opencode'),
			cursorTarget: getTarget(props.editingAgent, 'cursor'),
			grokTarget: getTarget(props.editingAgent, 'grok'),
			codexTarget: getTarget(props.editingAgent, 'codex'),
		},
		onSubmit: (submission) => {
			const values: AgentFormValues = submission.value;
			setSaveError(undefined);
			saveMutation.mutate({
				name: values.name.trim(),
				targets: getFormTargets(values),
			});
		},
	});
	const canSubmit = useStore(form.store, (state) => state.canSubmit);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className="grid gap-5 py-4"
		>
			<form.Field
				name="name"
				validators={{
					onChange: (validation) =>
						validation.value.trim() === '' ? 'Name is required' : undefined,
				}}
			>
				{(field) => {
					const isInvalid =
						field.state.meta.isTouched && field.state.meta.errors.length > 0;
					return (
						<Field data-invalid={isInvalid}>
							<FieldLabel htmlFor={field.name}>Name</FieldLabel>
							<Input
								id={field.name}
								value={field.state.value}
								disabled={props.editingAgent !== undefined}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									setSaveError(undefined);
								}}
								placeholder="e.g. reviewer"
								aria-invalid={isInvalid}
							/>
							{props.editingAgent !== undefined ? (
								<FieldDescription>
									Agent names cannot be changed.
								</FieldDescription>
							) : null}
							{isInvalid ? (
								<FieldError errors={field.state.meta.errors} />
							) : null}
						</Field>
					);
				}}
			</form.Field>

			<div className="grid gap-3">
				<div>
					<h3 className="text-sm font-medium text-foreground">
						Harness mappings
					</h3>
					<p className="mt-1 text-sm text-muted-foreground">
						Map this agent type to a harness-native agent.
					</p>
				</div>
				<div className="grid gap-5 rounded-md border border-border p-4">
					<form.Field name="opencodeTarget">
						{(field) => (
							<OpenCodeTargetSelect
								value={field.state.value}
								onChange={(value) => {
									field.handleChange(value);
									setSaveError(undefined);
								}}
							/>
						)}
					</form.Field>
					<form.Field name="cursorTarget">
						{(field) => (
							<UnsupportedTargetField
								backend="cursor"
								value={field.state.value}
							/>
						)}
					</form.Field>
					<form.Field name="grokTarget">
						{(field) => (
							<UnsupportedTargetField
								backend="grok"
								value={field.state.value}
							/>
						)}
					</form.Field>
					<form.Field name="codexTarget">
						{(field) => (
							<UnsupportedTargetField
								backend="codex"
								value={field.state.value}
							/>
						)}
					</form.Field>
				</div>
			</div>

			{saveError !== undefined ? (
				<Alert variant="destructive">
					<AlertTitle>Could not save agent</AlertTitle>
					<AlertDescription>{saveError}</AlertDescription>
				</Alert>
			) : null}

			<DialogFooter>
				<Button type="button" variant="outline" onClick={props.onCancel}>
					Cancel
				</Button>
				<Button
					type="submit"
					disabled={!canSubmit || isSubmitting || saveMutation.isPending}
				>
					{saveMutation.isPending ? 'Saving…' : 'Save'}
				</Button>
			</DialogFooter>
		</form>
	);
}

function AgentTargets(props: { agent: Agent }) {
	if (props.agent.targets.length === 0) {
		return <span className="text-muted-foreground">Not mapped</span>;
	}

	return (
		<div className="grid gap-1">
			{props.agent.targets.map((target) => (
				<div key={target.backend} className="flex items-baseline gap-2">
					<span className="text-muted-foreground">
						{HARNESS_NAMES[target.backend]}
					</span>
					<code className="font-mono text-foreground">{target.target}</code>
				</div>
			))}
		</div>
	);
}

export function AgentsPage() {
	const queryClient = useQueryClient();
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingAgent, setEditingAgent] = useState<Agent | undefined>();
	const [deleteTarget, setDeleteTarget] = useState<Agent | undefined>();
	const [deleteError, setDeleteError] = useState<string | undefined>();
	const listQuery = useQuery({
		queryKey: queryKeys.agents(),
		queryFn: () => orpc.agents.list(),
	});
	const deleteMutation = useMutation({
		mutationFn: (name: string) => orpc.agents.delete({ name }),
		onSuccess: (result) => {
			if (!result.ok) {
				setDeleteError('Agent not found');
				return;
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
			setDeleteTarget(undefined);
			setDeleteError(undefined);
		},
		onError: (error: Error) => {
			setDeleteError(error.message);
		},
	});

	function openCreate() {
		setEditingAgent(undefined);
		setIsFormOpen(true);
	}

	function openEdit(agent: Agent) {
		setEditingAgent(agent);
		setIsFormOpen(true);
	}

	function closeForm() {
		setIsFormOpen(false);
		setEditingAgent(undefined);
	}

	function closeDeleteDialog() {
		setDeleteTarget(undefined);
		setDeleteError(undefined);
		deleteMutation.reset();
	}

	function handleDelete() {
		if (deleteTarget === undefined) return;
		setDeleteError(undefined);
		deleteMutation.mutate(deleteTarget.name);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex items-center justify-between border-b border-border px-22 py-15">
				<span className="text-subheading font-light text-foreground">
					Agents
				</span>
				<Button onClick={openCreate}>Create agent</Button>
			</header>

			<main className="flex-1 overflow-y-auto px-33 py-22">
				<div className="mx-auto max-w-[900px]">
					{listQuery.isPending ? (
						<div className="py-66 text-center text-caption text-muted-foreground">
							Loading agents…
						</div>
					) : listQuery.isError ? (
						<div className="flex flex-col items-center gap-4 py-66">
							<p className="text-sm text-destructive">
								Could not load agents: {listQuery.error.message}
							</p>
							<Button
								type="button"
								variant="outline"
								onClick={() => listQuery.refetch()}
							>
								Retry
							</Button>
						</div>
					) : listQuery.data.length === 0 ? (
						<div className="flex flex-col items-center gap-22 py-66 text-muted-foreground">
							<p className="text-body font-light">No agents yet</p>
							<p className="text-caption">
								Create an agent type and map it to a harness-native agent
							</p>
							<Button onClick={openCreate}>Create agent</Button>
						</div>
					) : (
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="border-b border-border text-muted-foreground">
									<th className="py-3 pr-4 font-normal">Name</th>
									<th className="py-3 pr-4 font-normal">Harness targets</th>
									<th className="py-3 text-right font-normal">Actions</th>
								</tr>
							</thead>
							<tbody>
								{listQuery.data.map((agent) => (
									<tr
										key={agent.name}
										className="border-b border-border last:border-b-0"
									>
										<td className="py-3 pr-4 font-mono text-foreground">
											{agent.name}
										</td>
										<td className="py-3 pr-4">
											<AgentTargets agent={agent} />
										</td>
										<td className="py-3 text-right">
											<div className="flex items-center justify-end gap-2">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openEdit(agent)}
												>
													Edit
												</Button>
												<Button
													variant="ghost"
													size="sm"
													className="text-destructive hover:text-destructive"
													onClick={() => {
														setDeleteError(undefined);
														setDeleteTarget(agent);
													}}
												>
													Delete
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</main>

			<Dialog
				open={isFormOpen}
				onOpenChange={(open) => {
					if (!open) closeForm();
				}}
			>
				<DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{editingAgent === undefined ? 'Create agent' : 'Edit agent'}
						</DialogTitle>
						<DialogDescription>
							{editingAgent === undefined
								? 'Define an agent type and its harness mappings.'
								: 'Update the harness mappings for this agent type.'}
						</DialogDescription>
					</DialogHeader>
					{isFormOpen ? (
						<AgentForm
							editingAgent={editingAgent}
							onSuccess={closeForm}
							onCancel={closeForm}
						/>
					) : null}
				</DialogContent>
			</Dialog>

			<Dialog
				open={deleteTarget !== undefined}
				onOpenChange={(open) => {
					if (!open) closeDeleteDialog();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete agent?</DialogTitle>
						<DialogDescription>
							This will permanently delete the agent{' '}
							{deleteTarget !== undefined ? (
								<code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
									{deleteTarget.name}
								</code>
							) : null}
							. This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					{deleteError !== undefined ? (
						<p className="text-sm text-destructive">{deleteError}</p>
					) : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={closeDeleteDialog}>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={handleDelete}
						>
							{deleteMutation.isPending ? 'Deleting…' : 'Delete'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
