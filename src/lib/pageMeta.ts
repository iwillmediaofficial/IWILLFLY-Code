import { useEffect } from 'react';

const SITE = 'IWILLFLY';

function descriptionTag() {
  return document.querySelector<HTMLMetaElement>('meta[name="description"]');
}

/**
 * Sets document.title and the meta description while a page is shown, and puts back what was
 * there before when it unmounts. Shop and mall pages also get these from the Worker for crawlers
 * (worker/seo.ts); this keeps them right after in-app navigation.
 */
export function usePageMeta(title: string | null | undefined, description?: string | null) {
  useEffect(() => {
    if (!title) return;
    const tag = descriptionTag();
    const prevTitle = document.title;
    const prevDescription = tag?.content;
    document.title = `${title} | ${SITE}`;
    if (tag && description) tag.content = description.replace(/\s+/g, ' ').trim().slice(0, 160);
    return () => {
      document.title = prevTitle;
      if (tag && prevDescription != null) tag.content = prevDescription;
    };
  }, [title, description]);
}
