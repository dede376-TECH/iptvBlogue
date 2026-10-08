import Callout from './mdx/Callout.astro';
import Diagram from './mdx/Diagram.astro';
import Result from './mdx/Result.astro';
import Step from './mdx/Step.astro';
import Steps from './mdx/Steps.astro';

/** Passed to `<Content components={mdxComponents} />`. Not inserted into existing articles. */
export const mdxComponents = { Callout, Steps, Step, Result, Diagram };
