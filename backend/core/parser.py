from typing import List, Dict
from ..schemas import WorkflowGraph, Node


class GraphParseError(Exception):
    """Niestandardowy wyjątek rzucany, gdy graf jest niepoprawny"""

    pass


class DAGParser:
    def __init__(self, graph: WorkflowGraph):
        self.graph = graph
        # Szybkie wyszukiwanie węzłów po id
        self.nodes_by_id: Dict[str, Node] = {node.id: node for node in graph.nodes}
        # Lista sąsiedztwa
        self.adjacency_list: Dict[str, List[str]] = {
            node.id: [] for node in graph.nodes
        }
        # Liczba krawędzi wchodzących do danego węzła
        self.in_degree: Dict[str, int] = {node.id: 0 for node in graph.nodes}

        self._build_graph()

    def _build_graph(self) -> None:
        """Przetwarza krawędzie na listę sąsiedztwa i liczbę krawędzi wchodzących do węzła"""
        for edge in self.graph.edges:
            if (
                edge.source not in self.nodes_by_id
                or edge.target not in self.nodes_by_id
            ):
                raise GraphParseError(
                    f"Krawędź odwołuje się do nieistniejącego węzła: {edge.source} -> {edge.target}"
                )

            self.adjacency_list[edge.source].append(edge.target)
            self.in_degree[edge.target] += 1

    def get_execution_plan(self) -> List[str]:
        """
        Główna metoda: Zwraca listę ID węzłów posortowaną topologicznie.
        Wykorzystuje algorytm Kahna.
        """
        queue = [node_id for node_id, degree in self.in_degree.items() if degree == 0]

        execution_order = []

        while queue:
            # Pobieramy pierwszy węzeł z kolejki
            current_node_id = queue.pop(0)
            execution_order.append(current_node_id)

            # Dla kazdego sąsiada do którego prowadzi nasz current_node_id
            for neighbor_id in self.adjacency_list[current_node_id]:
                self.in_degree[neighbor_id] -= 1

                if self.in_degree[neighbor_id] == 0:
                    queue.append(neighbor_id)

        # Sprawdzanie cykli
        if len(execution_order) != len(self.nodes_by_id):
            raise GraphParseError(
                "Wykryto nieskończoną pętlę!"
                "Silnik obsługuje tylko skierowane grafy acykliczne!"
            )

        return execution_order
