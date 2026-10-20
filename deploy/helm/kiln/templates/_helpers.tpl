{{- define "kiln.labels" -}}
app.kubernetes.io/part-of: kiln
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
