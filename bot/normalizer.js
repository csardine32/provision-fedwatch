export function normalizeOpportunity(raw) {
  const noticeId = raw?.noticeId ?? raw?.id ?? "";
  const title = raw?.title ?? raw?.solicitationTitle ?? "";
  const solicitationNumber = raw?.solicitationNumber ?? raw?.solNum ?? "";
  const agencyPath = raw?.fullParentPathName ?? raw?.fullParentPathCode ?? raw?.departmentName ?? "";
  const postedDate = raw?.postedDate ?? raw?.postedDateString ?? "";
  const responseDeadline = raw?.responseDeadLine ?? raw?.responseDeadline ?? raw?.dueDate ?? "";
  const naicsCode = raw?.naicsCode ?? raw?.naics ?? "";
  const classificationCode = raw?.classificationCode ?? raw?.psc ?? raw?.pscCode ?? "";
  const setAside = raw?.typeOfSetAsideDescription ?? raw?.setAsideDescription ?? raw?.typeOfSetAside ?? "";
  const setAsideCode = raw?.typeOfSetAside ?? raw?.setAsideCode ?? "";
  const placeOfPerformance = raw?.placeOfPerformance?.city?.name
    ? `${raw.placeOfPerformance.city.name}, ${raw.placeOfPerformance.state?.code ?? ""}`.trim()
    : raw?.placeOfPerformance?.address?.cityName ?? raw?.placeOfPerformance?.address?.stateCode ?? "";
  const officeAddress = raw?.officeAddress?.streetAddress ?? raw?.officeAddress?.city ?? "";
  const pointOfContact = raw?.pointOfContact
    ? {
        name: raw.pointOfContact?.fullName ?? raw.pointOfContact?.name ?? "",
        email: raw.pointOfContact?.email ?? "",
        phone: raw.pointOfContact?.phone ?? "",
      }
    : null;

  const links = Array.isArray(raw?.links) ? raw.links : [];
  const additionalInfoLink = raw?.additionalInfoLink ?? raw?.additionalInfoUrl ?? "";
  const uiLink = raw?.uiLink ?? raw?.uiLinkUrl ?? "";
  const resourceLinks = Array.isArray(raw?.resourceLinks) ? raw.resourceLinks : [];
  const descriptionLink = raw?.description ?? raw?.descriptionLink ?? raw?.descriptionUrl ?? "";

  return {
    noticeId,
    title,
    solicitationNumber,
    agencyPath,
    postedDate,
    responseDeadline,
    naicsCode,
    classificationCode,
    setAside,
    setAsideCode,
    placeOfPerformance,
    officeAddress,
    pointOfContact,
    additionalInfoLink,
    uiLink,
    links,
    resourceLinks,
    descriptionLink,
  };
}
