export function readOwnData<T = unknown>(container: object | string, key: string): T | undefined;
export function ownDataKeys(container: object): string[];
export function ownDataEntries<const Container extends object>(
  container: Container,
): Array<[Extract<keyof Container, string>, Container[Extract<keyof Container, string>]]>;
type MergeTwo<Left, Right> = Omit<Left, keyof Right> & Right;
type MergeRecords<Records extends readonly object[], Output = object> = Records extends readonly [
  infer Head extends object,
  ...infer Tail extends readonly object[],
]
  ? MergeRecords<Tail, MergeTwo<Output, Head>>
  : Output;
export function mergeOwnDataRecords<const Records extends readonly object[]>(
  ...records: Records
): MergeRecords<Records>;
export function writeOwnData(container: object, key: string, value: unknown): void;
