type MergeTwo<Left, Right> = Omit<Left, keyof Right> & Right;
type MergeRecords<Records extends readonly object[], Output = object> = Records extends readonly [
  infer Head extends object,
  ...infer Tail extends readonly object[],
]
  ? MergeRecords<Tail, MergeTwo<Output, Head>>
  : Output;

export function mergeSyntheticRecords<const Records extends readonly object[]>(
  ...records: Records
): MergeRecords<Records>;
export function defineSyntheticProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void;
export function createSyntheticProxy<T extends object>(target: T, handler: ProxyHandler<T>): T;
export function forwardSyntheticGet(target: object, key: PropertyKey, receiver: unknown): unknown;
export function forwardSyntheticDescriptor(
  target: object,
  key: PropertyKey,
): PropertyDescriptor | undefined;
export function forwardSyntheticOwnKeys(target: object): ArrayLike<string | symbol>;
