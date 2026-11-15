import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// On web, we redirect /categories/:id to /categories and let the sidebar handle filtering
// This keeps the route working for links from other pages (product cards, banners, etc.)
export default function CategoryProductsPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/categories?cat=${categoryId}`, { replace: true });
  }, [categoryId, navigate]);

  return null;
}
