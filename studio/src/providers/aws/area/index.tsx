// Cloudscape's fonts (`@font-face` only, embedded): imported by path, as the package does not export this file.
import '../../../../node_modules/@cloudscape-design/global-styles/fonts.css';
import './styles/index-base.scoped.css';
import './styles/base-theme-root.css';

import { AreaLayout, type AreaLayoutProps } from './area-layout';

/**
 * The AWS area: everything Studio shows at `/aws` and below. Loaded only through `providers/aws/provider.ts`, with a
 * dynamic `import()`, so its code and Cloudscape's styles load only when a path of the area is opened.
 */
export default function AwsArea(props: AreaLayoutProps) {
  return <AreaLayout {...props} />;
}
