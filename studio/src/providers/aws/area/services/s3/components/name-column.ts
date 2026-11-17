// The room a table's name column keeps on the S3 screens (issue 467, requirement R6): a name of up to 24 characters
// is on one line at 1280 and 390 wide; a longer one breaks inside its cell rather than widening its column.

/** 24 characters of the cell's text and the cell's own padding, in the text's own unit. */
export const NAME_COLUMN_MIN_WIDTH = '28ch';
