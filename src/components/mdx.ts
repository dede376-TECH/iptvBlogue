import Callout from './mdx/Callout.astro';
import Diagram from './mdx/Diagram.astro';
import Figure from './mdx/Figure.astro';
import Result from './mdx/Result.astro';
import ScreenshotSlot from './mdx/ScreenshotSlot.astro';
import Step from './mdx/Step.astro';
import Steps from './mdx/Steps.astro';

/** Passed to `<Content components={mdxComponents} />`. */
export const mdxComponents = { Callout, Steps, Step, Result, Diagram, Figure, ScreenshotSlot };
