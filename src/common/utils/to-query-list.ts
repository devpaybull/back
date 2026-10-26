export const toQueryList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' || Array.isArray(value)
    ? [value]
        .flat()
        .flatMap((item: unknown) =>
          typeof item === 'string' ? item.split(',') : [item],
        )
        .map((item: unknown) => (typeof item === 'string' ? item.trim() : item))
        .filter((item) => item !== '')
    : value;
