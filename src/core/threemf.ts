import { zipSync, strToU8 } from 'fflate'
import type { SolidMesh } from './mesh'

export interface MeshPart {
  name: string
  mesh: SolidMesh
  /** 1-based filament slot the part is printed with. */
  extruder: number
}

export interface ThreeMFOptions {
  name: string
  bedX: number
  bedY: number
}

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&apos;'
    }
  })

const num = (value: number): string => {
  const rounded = Number(value.toFixed(5))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function meshXml(mesh: SolidMesh): string {
  const vertices: string[] = []
  for (let i = 0; i < mesh.positions.length; i += 3) {
    vertices.push(
      `    <vertex x="${num(mesh.positions[i])}" y="${num(mesh.positions[i + 1])}" z="${num(
        mesh.positions[i + 2],
      )}"/>`,
    )
  }
  const triangles: string[] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    triangles.push(
      `    <triangle v1="${mesh.indices[i]}" v2="${mesh.indices[i + 1]}" v3="${
        mesh.indices[i + 2]
      }"/>`,
    )
  }
  return [
    '   <mesh>',
    '    <vertices>',
    ...vertices,
    '    </vertices>',
    '    <triangles>',
    ...triangles,
    '    </triangles>',
    '   </mesh>',
  ].join('\n')
}

const uuid = (n: number): string =>
  `${n.toString(16).padStart(8, '0')}-61cb-4c03-9d28-80fed5dfa1dc`

/**
 * Write a Bambu Studio / OrcaSlicer project 3MF: one object made of several
 * parts, each pinned to a filament slot so the sign opens ready to print in
 * colour.
 */
export function buildThreeMF(parts: MeshPart[], options: ThreeMFOptions): Uint8Array {
  if (parts.length === 0) throw new Error('Nothing to export.')

  const assemblyId = 1
  const partIds = parts.map((_, i) => i + 2)

  const objects = parts.map((part, i) => {
    return [
      `  <object id="${partIds[i]}" p:uuid="${uuid(partIds[i])}" type="model">`,
      meshXml(part.mesh),
      '  </object>',
    ].join('\n')
  })

  const components = partIds
    .map(
      (id) =>
        `   <component objectid="${id}" p:uuid="${uuid(
          id + 100,
        )}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
    )
    .join('\n')

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <metadata name="Application">emboss</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${escapeXml(options.name)}</metadata>
 <resources>
${objects.join('\n')}
  <object id="${assemblyId}" p:uuid="${uuid(assemblyId)}" type="model">
   <components>
${components}
   </components>
  </object>
 </resources>
 <build p:uuid="${uuid(9999)}">
  <item objectid="${assemblyId}" p:uuid="${uuid(8888)}" transform="1 0 0 0 1 0 0 0 1 ${num(
    options.bedX / 2,
  )} ${num(options.bedY / 2)} 0" printable="1"/>
 </build>
</model>`

  const partConfig = parts
    .map((part, i) =>
      [
        `  <part id="${partIds[i]}" subtype="normal_part">`,
        `   <metadata key="name" value="${escapeXml(part.name)}"/>`,
        `   <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>`,
        `   <metadata key="source_file" value="${escapeXml(options.name)}.3mf"/>`,
        `   <metadata key="source_object_id" value="0"/>`,
        `   <metadata key="source_volume_id" value="${i}"/>`,
        `   <metadata key="extruder" value="${part.extruder}"/>`,
        `   <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>`,
        '  </part>',
      ].join('\n'),
    )
    .join('\n')

  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="${assemblyId}">
  <metadata key="name" value="${escapeXml(options.name)}"/>
  <metadata key="extruder" value="${parts[0].extruder}"/>
${partConfig}
 </object>
 <plate>
  <metadata key="plater_id" value="1"/>
  <metadata key="plater_name" value=""/>
  <metadata key="locked" value="false"/>
  <model_instance>
   <metadata key="object_id" value="${assemblyId}"/>
   <metadata key="instance_id" value="0"/>
   <metadata key="identify_id" value="1"/>
  </model_instance>
 </plate>
</config>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
    },
    { level: 6 },
  )
}
