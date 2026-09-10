// TODO: Phase G (Invoices/delivery) - Tokenized invoice access endpoint
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ params }) => {
  return new Response(
    `Invoice access placeholder for token: ${params.token ?? ""} - Phase E`,
    {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }
  );
};
