import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useState } from 'react';

type UseControllableStateOptions<T> = {
	prop?: T;
	defaultProp: T;
	onChange?: (value: T) => void;
};

function useControllableState<T>(options: UseControllableStateOptions<T>) {
	const [uncontrolledValue, setUncontrolledValue] = useState(
		options.defaultProp,
	);
	const isControlled = options.prop !== undefined;
	const value = options.prop === undefined ? uncontrolledValue : options.prop;

	const setValue = useCallback<Dispatch<SetStateAction<T>>>(
		(nextValue) => {
			const resolvedValue =
				typeof nextValue === 'function'
					? (nextValue as (previousValue: T) => T)(value)
					: nextValue;

			if (Object.is(value, resolvedValue)) return;

			if (!isControlled) setUncontrolledValue(resolvedValue);
			options.onChange?.(resolvedValue);
		},
		[isControlled, options.onChange, value],
	);

	return [value, setValue] as const;
}

export { useControllableState };
