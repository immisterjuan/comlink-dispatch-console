import { useEffect } from 'react';

// Sets the browser tab title for the current page (default lives in
// index.html and is shown before any page mounts).
export const usePageTitle = (title: string): void => {
  useEffect(() => {
    document.title = title;
  }, [title]);
};
