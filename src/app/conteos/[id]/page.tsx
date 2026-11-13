import { notFound, redirect } from "next/navigation";
import { PantallaConteo } from "@/components/PantallaConteo";
import { crearClienteServidor } from "@/lib/supabase/server";

export default async function PaginaConteo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await crearClienteServidor();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect("/login");

  const { data: c } = await sb.from("conteos").select("id,localidad_id,status,localidades(nombre)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const nombre = (c.localidades as unknown as { nombre: string } | null)?.nombre ?? "Localidad";

  return <PantallaConteo conteo={{ id: c.id, localidad_id: c.localidad_id, localidad_nombre: nombre, status: c.status }} />;
}
