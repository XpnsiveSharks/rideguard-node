export function parseEnumValue<TEnum extends Record<string, string>>(
  value: string | undefined,
  enumObject: TEnum,
  fieldName: string,
): TEnum[keyof TEnum] {
  if (value === undefined) {
    throw new Error(`${fieldName} is required.`);
  }

  const parsedValue = value.trim();
  const enumValues = Object.values(enumObject) as Array<TEnum[keyof TEnum]>;

  if (!enumValues.includes(parsedValue as TEnum[keyof TEnum])) {
    throw new Error(
      `Invalid ${fieldName} "${parsedValue}". Please select a valid ${fieldName} type.`,
    );
  }

  return parsedValue as TEnum[keyof TEnum];
}

export function parseOptionalEnumValue<TEnum extends Record<string, string>>(
  value: string | undefined,
  enumObject: TEnum,
  fieldName: string,
): TEnum[keyof TEnum] | undefined {
  if (value === undefined) return undefined;

  return parseEnumValue(value, enumObject, fieldName);
}
