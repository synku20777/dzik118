import type { APIRoute } from "astro";

export const GET: APIRoute = ({ params, redirect }) => {
  const { orgId, name } = params;
  const template = name === "starting-readings.csv" ? "meters.csv" : name;
  if (!orgId || (template !== "dwellings.csv" && template !== "meters.csv")) {
    return new Response("Not found", { status: 404 });
  }
  return redirect("/admin/o/" + orgId + "/migration/templates/" + template);
};
