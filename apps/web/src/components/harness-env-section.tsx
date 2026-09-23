import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	type HarnessEnvEntry,
	validateDuplicateEnvironmentKeys,
	validateEnvironmentKeyAtIndex,
} from '@/lib/harness-env-validation';
import type { Backend } from '@/lib/harnesses';
import { orpc } from '@/lib/orpc';

type HarnessEnvFormEntry = HarnessEnvEntry & {
	id: string;
};

function toFormEntries(
	entries: ReadonlyArray<HarnessEnvEntry>,
): Array<HarnessEnvFormEntry> {
	return entries.map((entry) => ({
		id: crypto.randomUUID(),
		key: entry.key,
		value: entry.value,
	}));
}

function HarnessEnvFields(props: { form: EnvForm }) {
	return (
		<props.form.Field
			name="env"
			mode="array"
			validators={{
				onChange: (change) => validateDuplicateEnvironmentKeys(change.value),
				onSubmit: (submission) =>
					validateDuplicateEnvironmentKeys(submission.value),
			}}
		>
			{(arrayField) => (
				<div className="flex flex-col gap-3">
					{arrayField.state.value.map((entry, index) => {
						const keyId = `${arrayField.name}-${index}-key`;
						const valueId = `${arrayField.name}-${index}-value`;
						return (
							<div
								className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
								key={entry.id}
							>
								<props.form.Field
									name={`env[${index}].key`}
									validators={{
										onChange: (change) =>
											validateEnvironmentKeyAtIndex(
												change.value,
												arrayField.state.value,
												index,
											),
										onSubmit: (submission) =>
											validateEnvironmentKeyAtIndex(
												submission.value,
												arrayField.state.value,
												index,
											),
									}}
								>
									{(field) => {
										const keyIsInvalid =
											field.state.meta.isTouched && !field.state.meta.isValid;
										return (
											<Field data-invalid={keyIsInvalid}>
												<FieldLabel>Name</FieldLabel>
												<Input
													id={keyId}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													aria-invalid={keyIsInvalid}
													placeholder="API_KEY"
													autoComplete="off"
													className="font-mono text-xs"
												/>
												{keyIsInvalid ? (
													<FieldError errors={field.state.meta.errors} />
												) : null}
											</Field>
										);
									}}
								</props.form.Field>

								<props.form.Field name={`env[${index}].value`}>
									{(field) => (
										<Field>
											<FieldLabel htmlFor={valueId}>Value</FieldLabel>
											<Input
												id={valueId}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												placeholder="value"
												autoComplete="off"
												className="font-mono text-xs"
											/>
										</Field>
									)}
								</props.form.Field>

								<Button
									type="button"
									variant="outline"
									onClick={() => arrayField.removeValue(index)}
								>
									Remove
								</Button>
							</div>
						);
					})}

					{arrayField.state.meta.errors.length > 0 ? (
						<FieldError errors={arrayField.state.meta.errors} />
					) : null}
					<Button
						type="button"
						variant="outline"
						onClick={() =>
							arrayField.pushValue({
								id: crypto.randomUUID(),
								key: '',
								value: '',
							})
						}
					>
						Add variable
					</Button>
				</div>
			)}
		</props.form.Field>
	);
}

type HarnessEnvSectionProps = {
	backend: Backend;
};

export function HarnessEnvSection(props: HarnessEnvSectionProps) {
	const envQuery = useQuery(
		orpc.settings.getHarnessEnv.queryOptions({
			input: { backend: props.backend },
		}),
	);

	return (
		<div className="grid max-w-xl gap-4 border-t border-border pt-8">
			<div>
				<h2 className="text-base font-medium text-foreground">
					Environment variables
				</h2>
				<FieldDescription className="mt-1">
					Variables are passed to newly started {props.backend} sessions.
					Existing sessions keep their current environment.
				</FieldDescription>
			</div>

			{envQuery.data !== undefined ? (
				<HarnessEnvForm backend={props.backend} entries={envQuery.data.env} />
			) : envQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">
					Loading environment variables…
				</p>
			) : envQuery.isError ? (
				<p className="text-sm text-destructive">
					Failed to load environment variables: {envQuery.error.message}
				</p>
			) : (
				<p className="text-sm text-muted-foreground">
					Environment variables are unavailable.
				</p>
			)}
		</div>
	);
}

type HarnessEnvFormProps = {
	backend: Backend;
	entries: ReadonlyArray<HarnessEnvEntry>;
};

function useHarnessEnvForm(props: {
	backend: Backend;
	entries: ReadonlyArray<HarnessEnvEntry>;
}) {
	const queryClient = useQueryClient();
	const saveMutation = useMutation(
		orpc.settings.setHarnessEnv.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.settings.getHarnessEnv.key({
						input: { backend: props.backend },
					}),
				});
			},
		}),
	);
	const form = useForm({
		defaultValues: { env: toFormEntries(props.entries) },
		onSubmit: (submission) => {
			saveMutation.mutate({
				backend: props.backend,
				env: submission.value.env.map((entry) => ({
					key: entry.key,
					value: entry.value,
				})),
			});
		},
	});
	return { form, saveMutation };
}
type EnvForm = ReturnType<typeof useHarnessEnvForm>['form'];

function HarnessEnvForm(props: HarnessEnvFormProps) {
	const harnessEnvForm = useHarnessEnvForm(props);
	const canSubmit = useStore(
		harnessEnvForm.form.store,
		(state) => state.canSubmit,
	);
	const isSubmitting = useStore(
		harnessEnvForm.form.store,
		(state) => state.isSubmitting,
	);

	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				harnessEnvForm.form.handleSubmit();
			}}
		>
			<HarnessEnvFields form={harnessEnvForm.form} />

			<div className="flex items-center gap-2">
				<Button
					type="submit"
					disabled={
						!canSubmit || isSubmitting || harnessEnvForm.saveMutation.isPending
					}
				>
					{harnessEnvForm.saveMutation.isPending ? 'Saving…' : 'Save'}
				</Button>
				{harnessEnvForm.saveMutation.isError ? (
					<p className="text-sm text-destructive">
						{harnessEnvForm.saveMutation.error.message}
					</p>
				) : null}
			</div>
		</form>
	);
}
