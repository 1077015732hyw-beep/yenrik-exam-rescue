/* ==========================================================================
   filetypes.js — 文件类型判定
   站内可以「在线预览」的类型：pdf / 图片 / dxf（2D 图纸）/ stl（3D 模型）。
   其余类型（dwg、step、office、压缩包…）明确提示并引导下载——
   其中 dwg 建议馆长从 CAD 里另存一份 DXF 或 PDF 一起上传。
   ========================================================================== */

export const TYPES = {
  pdf:    { key: 'pdf',    label: 'PDF',  name: 'Portable Document Format', icon: 'i-pdf',     preview: 'pdf' },
  image:  { key: 'image',  label: 'IMG',  name: '图片',                      icon: 'i-image',   preview: 'image' },
  dxf:    { key: 'dxf',    label: 'DXF',  name: 'CAD 图纸（DXF）',           icon: 'i-drawing', preview: 'dxf' },
  stl:    { key: 'stl',    label: 'STL',  name: '三维模型（STL）',           icon: 'i-cube',    preview: 'stl' },
  dwg:    { key: 'dwg',    label: 'DWG',  name: 'CAD 图纸（DWG）',           icon: 'i-drawing', preview: null },
  step:   { key: 'step',   label: 'STEP', name: '三维模型（STEP / IGES）',   icon: 'i-cube',    preview: null },
  obj:    { key: 'obj',    label: 'OBJ',  name: '三维模型（OBJ）',           icon: 'i-cube',    preview: null },
  doc:    { key: 'doc',    label: 'DOC',  name: 'Word 文档',                 icon: 'i-doc',     preview: null },
  slides: { key: 'slides', label: 'PPT',  name: '演示文稿',                   icon: 'i-doc',     preview: null },
  sheet:  { key: 'sheet',  label: 'XLS',  name: '表格',                       icon: 'i-doc',     preview: null },
  zip:    { key: 'zip',    label: 'ZIP',  name: '压缩包',                     icon: 'i-file',    preview: null },
  file:   { key: 'file',   label: 'FILE', name: '文件',                       icon: 'i-file',    preview: null },
};

const EXT = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image', bmp: 'image',
  dxf: 'dxf',
  stl: 'stl',
  dwg: 'dwg', dws: 'dwg', dwt: 'dwg',
  step: 'step', stp: 'step', iges: 'step', igs: 'step',
  obj: 'obj',
  doc: 'doc', docx: 'doc', rtf: 'doc', odt: 'doc', pages: 'doc',
  ppt: 'slides', pptx: 'slides', key: 'slides', odp: 'slides',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet', numbers: 'sheet',
  zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip',
};

export function fileExt(path = '') {
  const clean = String(path).split('?')[0].split('#')[0];
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** 判定类型：JSON 里显式写 type 时优先（可覆盖扩展名，例如把 .dwg 里的 DXF 标出来） */
export function fileType(path, override) {
  const ext = fileExt(path);
  const key = (override && TYPES[override] && override) || EXT[ext] || 'file';
  return { ...TYPES[key], ext };
}

export const isPreviewable = (path, override) => Boolean(fileType(path, override).preview);

/** 不能在线预览时，给用户的解释与替代建议 */
export function unsupportedHint(type) {
  switch (type.key) {
    case 'dwg':
      return 'DWG 是 AutoCAD 的专有格式，浏览器里没法直接解析。可以下载后用 CAD 打开；'
        + '如果想让朋友在线看图，请馆长从 CAD 里「另存为 DXF 或 PDF」一起上传。';
    case 'step':
    case 'obj':
      return '这类三维格式暂时只支持在线预览 STL。可以下载后用建模软件打开，'
        + '或请馆长另存一份 STL 一起上传。';
    case 'doc':
    case 'slides':
    case 'sheet':
      return 'Office 文档无法在浏览器里如实还原排版。可以下载后查看；'
        + '如果希望在线翻阅，请馆长同时导出一份 PDF。';
    case 'zip':
      return '压缩包没法在线预览。下载解压后查看即可。';
    default:
      return '这个格式暂时不支持在线预览，下载后用本地软件打开即可。';
  }
}
